// Support tickets — customer portal + admin conversation thread.
// Guest contact-form submissions create tickets without a linked account
// (guestName/guestEmail), exactly like a sales inbox.

import { randomInt } from "node:crypto";
import { db } from "@/lib/db";
import type { PanelUser, Ticket, TicketMessage } from "@prisma/client";
import { HttpError } from "@/lib/api/http";
import { notificationService } from "@/lib/notifications";
import { audit } from "@/lib/audit";
import type { TicketDTO, TicketListEntryDTO } from "@/lib/api/types";

const CATEGORIES = ["technical", "billing", "sales", "drive", "other"] as const;
const PRIORITIES = ["low", "normal", "high", "urgent"] as const;

function toTicketDTO(ticket: Ticket & { messages: TicketMessage[] }): TicketDTO {
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    category: ticket.category as TicketDTO["category"],
    priority: ticket.priority as TicketDTO["priority"],
    status: ticket.status as TicketDTO["status"],
    guestName: ticket.guestName,
    guestEmail: ticket.guestEmail,
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    messages: ticket.messages.map((m) => ({
      id: m.id,
      senderRole: m.senderRole as TicketDTO["messages"][number]["senderRole"],
      senderName: m.senderName,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    })),
  };
}

async function toListEntry(ticket: Ticket): Promise<TicketListEntryDTO> {
  const [messageCount, lastMessage] = await Promise.all([
    db.ticketMessage.count({ where: { ticketId: ticket.id } }),
    db.ticketMessage.findFirst({ where: { ticketId: ticket.id }, orderBy: { createdAt: "desc" } }),
  ]);
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    category: ticket.category as TicketListEntryDTO["category"],
    priority: ticket.priority as TicketListEntryDTO["priority"],
    status: ticket.status as TicketListEntryDTO["status"],
    createdAt: ticket.createdAt.toISOString(),
    updatedAt: ticket.updatedAt.toISOString(),
    lastMessageAt: (lastMessage?.createdAt ?? ticket.createdAt).toISOString(),
    messageCount,
  };
}

export const ticketService = {
  /** Customer creates a ticket (portal). */
  async create(
    user: PanelUser,
    input: { subject: string; category: string; priority: string; body: string },
  ): Promise<TicketDTO> {
    const subject = String(input.subject ?? "").trim();
    const body = String(input.body ?? "").trim();
    if (subject.length < 3) throw new HttpError(400, "INVALID_SUBJECT", "موضوع تیکت باید حداقل ۳ نویسه باشد.");
    if (body.length < 10) throw new HttpError(400, "INVALID_BODY", "شرح مشکل باید حداقل ۱۰ نویسه باشد.");
    const category = (CATEGORIES as readonly string[]).includes(input.category) ? input.category : "other";
    const priority = (PRIORITIES as readonly string[]).includes(input.priority) ? input.priority : "normal";

    const ticket = await db.ticket.create({
      data: {
        number: `TKT-${randomInt(100000, 999999)}`,
        userId: user.id,
        subject,
        category,
        priority,
        messages: {
          create: { senderRole: "customer", senderName: user.name ?? user.email, body },
        },
      },
      include: { messages: true },
    });
    await audit({ actor: user, action: "ticket.created", entityType: "ticket", entityId: ticket.id });
    await notificationService.notifyAdmins({
      category: "ticket",
      title: "تیکت جدید",
      body: `تیکت ${ticket.number} («${subject}») توسط ${user.name ?? user.email} ثبت شد.`,
      link: `/admin/tickets`,
    });
    return toTicketDTO(ticket);
  },

  /** Guest contact form → sales ticket without an account. */
  async createGuest(input: {
    name: string;
    email: string;
    mobile?: string;
    subject: string;
    message: string;
  }): Promise<void> {
    const name = String(input.name ?? "").trim();
    const email = String(input.email ?? "").trim().toLowerCase();
    const subject = String(input.subject ?? "").trim();
    const message = String(input.message ?? "").trim();
    if (name.length < 2) throw new HttpError(400, "INVALID_NAME", "نام را وارد کنید.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, "INVALID_EMAIL", "ایمیل معتبر نیست.");
    if (subject.length < 3) throw new HttpError(400, "INVALID_SUBJECT", "موضوع باید حداقل ۳ نویسه باشد.");
    if (message.length < 10) throw new HttpError(400, "INVALID_MESSAGE", "پیام باید حداقل ۱۰ نویسه باشد.");
    const mobile = input.mobile?.trim() || null;

    const ticket = await db.ticket.create({
      data: {
        number: `TKT-${randomInt(100000, 999999)}`,
        guestName: name,
        guestEmail: email,
        subject: `【فرم تماس】 ${subject}`,
        category: "sales",
        priority: "normal",
        messages: {
          create: {
            senderRole: "customer",
            senderName: name,
            body: `${message}${mobile ? `\n\nشماره تماس: ${mobile}` : ""}\n\nایمیل: ${email}`,
          },
        },
      },
    });
    await audit({
      actorLabel: `مهمان: ${name}`,
      action: "ticket.guest_created",
      entityType: "ticket",
      entityId: ticket.id,
    });
    await notificationService.notifyAdmins({
      category: "ticket",
      title: "پیام جدید از فرم تماس",
      body: `«${subject}» از ${name} (${email})`,
      link: "/admin/tickets",
    });
  },

  async list(userId: string): Promise<TicketListEntryDTO[]> {
    const tickets = await db.ticket.findMany({ where: { userId }, orderBy: { updatedAt: "desc" } });
    return Promise.all(tickets.map(toListEntry));
  },

  async get(userId: string, id: string): Promise<TicketDTO> {
    const ticket = await db.ticket.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "تیکت یافت نشد.");
    return toTicketDTO(ticket);
  },

  async reply(user: PanelUser, id: string, body: string): Promise<TicketDTO> {
    const trimmed = String(body ?? "").trim();
    if (trimmed.length < 2) throw new HttpError(400, "INVALID_BODY", "متن پاسخ را وارد کنید.");
    const ticket = await db.ticket.findFirst({ where: { id, userId: user.id } });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "تیکت یافت نشد.");
    if (ticket.status === "closed") throw new HttpError(409, "TICKET_CLOSED", "این تیکت بسته شده است؛ تیکت جدید ثبت کنید.");

    const updated = await db.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "open",
        updatedAt: new Date(),
        messages: {
          create: { senderRole: "customer", senderName: user.name ?? user.email, body: trimmed },
        },
      },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });
    await notificationService.notifyAdmins({
      category: "ticket",
      title: "پاسخ مشتری",
      body: `${user.name ?? user.email} به تیکت ${ticket.number} پاسخ داد.`,
      link: "/admin/tickets",
    });
    return toTicketDTO(updated);
  },

  async close(user: PanelUser, id: string): Promise<void> {
    const ticket = await db.ticket.findFirst({ where: { id, userId: user.id } });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "تیکت یافت نشد.");
    await db.ticket.update({ where: { id: ticket.id }, data: { status: "closed" } });
    await audit({ actor: user, action: "ticket.closed", entityType: "ticket", entityId: ticket.id });
  },

  // ---- admin (staff) side ----------------------------------------------------

  async adminList(
    status?: string,
  ): Promise<Array<TicketListEntryDTO & { customerName: string | null; customerEmail: string | null; guestName: string | null; guestEmail: string | null }>> {
    const tickets = await db.ticket.findMany({
      where: status ? { status } : undefined,
      orderBy: { updatedAt: "desc" },
      include: { user: { select: { email: true, name: true } } },
    });
    return Promise.all(
      tickets.map(async (t) => ({
        ...(await toListEntry(t)),
        customerName: t.user?.name ?? null,
        customerEmail: t.user?.email ?? null,
        guestName: t.guestName,
        guestEmail: t.guestEmail,
      })),
    );
  },

  async adminGet(id: string): Promise<TicketDTO & { customerEmail: string | null }> {
    const ticket = await db.ticket.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } }, user: { select: { email: true } } },
    });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "تیکت یافت نشد.");
    return { ...toTicketDTO(ticket), customerEmail: ticket.user?.email ?? null };
  },

  async adminReply(staff: PanelUser, id: string, body: string): Promise<void> {
    const trimmed = String(body ?? "").trim();
    if (trimmed.length < 2) throw new HttpError(400, "INVALID_BODY", "متن پاسخ را وارد کنید.");
    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "تیکت یافت نشد.");
    await db.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "answered",
        updatedAt: new Date(),
        messages: {
          create: { senderRole: "staff", senderName: staff.name ?? staff.email, body: trimmed },
        },
      },
    });
    await audit({ actor: staff, action: "ticket.replied", entityType: "ticket", entityId: ticket.id });
    if (ticket.userId) {
      await notificationService.notify(ticket.userId, {
        category: "ticket",
        title: "پاسخ جدید به تیکت شما",
        body: `تیکت ${ticket.number} («${ticket.subject}») پاسخ داده شد.`,
        link: `/portal/tickets/${ticket.id}`,
      });
    }
  },

  async adminClose(staff: PanelUser, id: string): Promise<void> {
    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) throw new HttpError(404, "TICKET_NOT_FOUND", "تیکت یافت نشد.");
    await db.ticket.update({ where: { id: ticket.id }, data: { status: "closed" } });
    await audit({ actor: staff, action: "ticket.closed_by_staff", entityType: "ticket", entityId: ticket.id });
    if (ticket.userId) {
      await notificationService.notify(ticket.userId, {
        category: "ticket",
        title: "تیکت بسته شد",
        body: `تیکت ${ticket.number} توسط پشتیبانی بسته شد.`,
        link: `/portal/tickets/${ticket.id}`,
      });
    }
  },
};
