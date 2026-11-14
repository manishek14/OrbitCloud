// Content management (CMS-lite) powering the public site: pages, services,
// FAQ entries and articles — manageable from the AbrIT Admin area.

import { db } from "@/lib/db";
import type { ContentItem, PanelUser } from "@prisma/client";
import { HttpError } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import type { ContentItemDTO } from "@/lib/api/types";

const TYPES = ["page", "faq", "service", "article"] as const;

function toDTO(item: ContentItem): ContentItemDTO {
  return {
    id: item.id,
    type: item.type as ContentItemDTO["type"],
    slug: item.slug,
    title: item.title,
    excerpt: item.excerpt,
    body: item.body,
    status: item.status as ContentItemDTO["status"],
    sortOrder: item.sortOrder,
    publishedAt: item.publishedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

function slugify(input: string): string {
  const slug = String(input ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9\u0600-\u06FF-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (slug.length < 2) throw new HttpError(400, "INVALID_SLUG", "نامک (slug) معتبر نیست؛ حداقل ۲ نویسه لاتین یا فارسی.");
  return slug;
}

export const contentService = {
  /** Public listing: published items only. */
  async publicList(type?: string, slug?: string): Promise<ContentItemDTO[]> {
    const items = await db.contentItem.findMany({
      where: {
        status: "published",
        ...(type && (TYPES as readonly string[]).includes(type) ? { type } : {}),
        ...(slug ? { slug } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return items.map(toDTO);
  },

  async adminList(type?: string): Promise<ContentItemDTO[]> {
    const items = await db.contentItem.findMany({
      where: type && (TYPES as readonly string[]).includes(type) ? { type } : undefined,
      orderBy: [{ type: "asc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
    });
    return items.map(toDTO);
  },

  async adminGet(id: string): Promise<ContentItemDTO> {
    const item = await db.contentItem.findUnique({ where: { id } });
    if (!item) throw new HttpError(404, "CONTENT_NOT_FOUND", "محتوای مورد نظر یافت نشد.");
    return toDTO(item);
  },

  async create(
    staff: PanelUser,
    input: { type: string; title: string; slug?: string; excerpt?: string; body?: string; status?: string; sortOrder?: number },
  ): Promise<ContentItemDTO> {
    const type = (TYPES as readonly string[]).includes(input.type) ? input.type : "page";
    const title = String(input.title ?? "").trim();
    if (title.length < 2) throw new HttpError(400, "INVALID_TITLE", "عنوان باید حداقل ۲ نویسه باشد.");
    const slug = slugify(input.slug || title);
    const existing = await db.contentItem.findUnique({ where: { slug } });
    if (existing) throw new HttpError(409, "SLUG_TAKEN", "این نامک قبلاً استفاده شده است.");
    const status = input.status === "published" ? "published" : "draft";
    const item = await db.contentItem.create({
      data: {
        type,
        slug,
        title,
        excerpt: input.excerpt?.trim() || null,
        body: input.body ?? "",
        status,
        sortOrder: Number.isInteger(input.sortOrder) ? Number(input.sortOrder) : 0,
        publishedAt: status === "published" ? new Date() : null,
      },
    });
    await audit({ actor: staff, action: "content.created", entityType: "content", entityId: item.id, meta: { title } });
    return toDTO(item);
  },

  async update(
    staff: PanelUser,
    id: string,
    input: Partial<{ title: string; excerpt: string; body: string; status: string; sortOrder: number; slug: string }>,
  ): Promise<ContentItemDTO> {
    const item = await db.contentItem.findUnique({ where: { id } });
    if (!item) throw new HttpError(404, "CONTENT_NOT_FOUND", "محتوای مورد نظر یافت نشد.");
    const data: Record<string, unknown> = {};
    if (input.title !== undefined) data.title = String(input.title).trim();
    if (input.excerpt !== undefined) data.excerpt = input.excerpt?.trim() || null;
    if (input.body !== undefined) data.body = String(input.body);
    if (input.sortOrder !== undefined) data.sortOrder = Number(input.sortOrder) || 0;
    if (input.slug !== undefined && input.slug !== item.slug) {
      const slug = slugify(input.slug);
      const existing = await db.contentItem.findUnique({ where: { slug } });
      if (existing) throw new HttpError(409, "SLUG_TAKEN", "این نامک قبلاً استفاده شده است.");
      data.slug = slug;
    }
    if (input.status !== undefined && input.status !== item.status) {
      data.status = input.status === "published" ? "published" : "draft";
      data.publishedAt = input.status === "published" ? new Date() : item.publishedAt;
    }
    const updated = await db.contentItem.update({ where: { id }, data });
    await audit({ actor: staff, action: "content.updated", entityType: "content", entityId: id, meta: { title: updated.title } });
    return toDTO(updated);
  },

  async remove(staff: PanelUser, id: string): Promise<void> {
    const item = await db.contentItem.findUnique({ where: { id } });
    if (!item) throw new HttpError(404, "CONTENT_NOT_FOUND", "محتوای مورد نظر یافت نشد.");
    await db.contentItem.delete({ where: { id } });
    await audit({ actor: staff, action: "content.deleted", entityType: "content", entityId: id, meta: { title: item.title } });
  },

  /** Recipe export: all content items as a portable JSON document. */
  async exportRecipe() {
    const items = await db.contentItem.findMany({ orderBy: [{ type: "asc" }, { sortOrder: "asc" }] });
    return { version: 1, exportedAt: new Date().toISOString(), contentItems: items.map(toDTO) };
  },

  /** Recipe import: creates missing slugs (idempotent), never overwrites. */
  async importRecipe(staff: PanelUser, payload: { contentItems?: Array<Record<string, unknown>> }) {
    const items = Array.isArray(payload.contentItems) ? payload.contentItems : [];
    let created = 0;
    let skipped = 0;
    for (const raw of items) {
      const slug = typeof raw.slug === "string" ? slugify(raw.slug) : null;
      const title = typeof raw.title === "string" ? raw.title.trim() : "";
      if (!slug || title.length < 2 || !(TYPES as readonly string[]).includes(String(raw.type))) {
        skipped++;
        continue;
      }
      const existing = await db.contentItem.findUnique({ where: { slug } });
      if (existing) {
        skipped++;
        continue;
      }
      await db.contentItem.create({
        data: {
          type: String(raw.type),
          slug,
          title,
          excerpt: typeof raw.excerpt === "string" ? raw.excerpt : null,
          body: typeof raw.body === "string" ? raw.body : "",
          status: raw.status === "published" ? "published" : "draft",
          sortOrder: Number.isInteger(raw.sortOrder) ? Number(raw.sortOrder) : 0,
          publishedAt: raw.status === "published" ? new Date() : null,
        },
      });
      created++;
    }
    await audit({ actor: staff, action: "recipe.imported", entityType: "content", meta: { created, skipped } });
    return { created, skipped };
  },
};
