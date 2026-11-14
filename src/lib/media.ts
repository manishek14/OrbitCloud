// Media library — uploads stored under public/uploads and recorded in the DB.
// Served as static files by the platform; manageable from the AbrIT Admin.

import { randomInt } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import type { PanelUser } from "@prisma/client";
import { HttpError } from "@/lib/api/http";
import { audit } from "@/lib/audit";
import type { AdminMediaDTO } from "@/lib/api/types";

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_SIZE_BYTES = 8 * 1024 * 1024; // 8 MB
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "application/pdf"];

function toDTO(asset: { id: string; name: string; path: string; mime: string; sizeBytes: number; createdAt: Date }): AdminMediaDTO {
  return {
    id: asset.id,
    name: asset.name,
    path: asset.path,
    mime: asset.mime,
    sizeBytes: asset.sizeBytes,
    createdAt: asset.createdAt.toISOString(),
  };
}

export const mediaService = {
  async list(): Promise<AdminMediaDTO[]> {
    const assets = await db.mediaAsset.findMany({ orderBy: { createdAt: "desc" } });
    return assets.map(toDTO);
  },

  async upload(staff: PanelUser, file: File): Promise<AdminMediaDTO> {
    if (!file || typeof file.arrayBuffer !== "function") {
      throw new HttpError(400, "NO_FILE", "فایلی برای بارگذاری ارسال نشد.");
    }
    if (file.size > MAX_SIZE_BYTES) {
      throw new HttpError(413, "FILE_TOO_LARGE", "حجم فایل بیش از ۸ مگابایت است.");
    }
    if (!ALLOWED_MIME.includes(file.type)) {
      throw new HttpError(415, "UNSUPPORTED_TYPE", "فقط تصاویر (PNG/JPEG/WebP/GIF/SVG) و PDF پذیرفته می‌شود.");
    }
    const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
    const safeName = `${Date.now()}-${randomInt(1000, 9999)}.${ext}`;
    await mkdir(UPLOAD_DIR, { recursive: true });
    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(UPLOAD_DIR, safeName), buffer);
    const asset = await db.mediaAsset.create({
      data: { name: file.name.slice(0, 120), path: `/uploads/${safeName}`, mime: file.type, sizeBytes: file.size },
    });
    await audit({ actor: staff, action: "media.uploaded", entityType: "media", entityId: asset.id, meta: { name: asset.name } });
    return toDTO(asset);
  },

  async remove(staff: PanelUser, id: string): Promise<void> {
    const asset = await db.mediaAsset.findUnique({ where: { id } });
    if (!asset) throw new HttpError(404, "MEDIA_NOT_FOUND", "فایل یافت نشد.");
    await unlink(path.join(process.cwd(), "public", asset.path.replace(/^\//, ""))).catch(() => undefined);
    await db.mediaAsset.delete({ where: { id } });
    await audit({ actor: staff, action: "media.deleted", entityType: "media", entityId: id, meta: { name: asset.name } });
  },

  /** Content query builder (admin Queries screen). */
  async queryContent(filters: { type?: string; status?: string; search?: string }) {
    const items = await db.contentItem.findMany({
      where: {
        ...(filters.type ? { type: filters.type } : {}),
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.search
          ? { OR: [{ title: { contains: filters.search } }, { body: { contains: filters.search } }] }
          : {}),
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    });
    return items.map((i) => ({
      id: i.id,
      type: i.type,
      slug: i.slug,
      title: i.title,
      excerpt: i.excerpt,
      body: i.body,
      status: i.status,
      sortOrder: i.sortOrder,
      publishedAt: i.publishedAt?.toISOString() ?? null,
      createdAt: i.createdAt.toISOString(),
      updatedAt: i.updatedAt.toISOString(),
    }));
  },
};
