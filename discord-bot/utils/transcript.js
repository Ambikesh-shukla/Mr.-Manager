import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { AttachmentBuilder } from 'discord.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TRANSCRIPT_DIR = join(__dirname, '../transcripts');

async function ensureDir() {
  if (!existsSync(TRANSCRIPT_DIR)) await mkdir(TRANSCRIPT_DIR, { recursive: true });
}

export async function generateTranscript(channel, ticket) {
  await ensureDir();
  const messages = [];
  let lastId;

  try {
    while (true) {
      const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
      if (fetched.size === 0) break;
      messages.push(...fetched.values());
      lastId = fetched.last().id;
      if (fetched.size < 100) break;
    }
  } catch { return null; }

  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  const lines = [
    `╔══════════════════════════════════════════════════════╗`,
    `║          TICKET TRANSCRIPT — ${new Date().toUTCString().slice(0,16)}         ║`,
    `╚══════════════════════════════════════════════════════╝`,
    ``,
    `Ticket ID:     ${ticket.id}`,
    `Ticket #:      ${ticket.ticketNumber}`,
    `Type:          ${ticket.ticketType}`,
    `Opened by:     ${ticket.username} (${ticket.userId})`,
    `Opened at:     ${new Date(ticket.openTime).toUTCString()}`,
    `Closed at:     ${ticket.closeTime ? new Date(ticket.closeTime).toUTCString() : 'N/A'}`,
    `Closed by:     ${ticket.closedBy ?? 'N/A'}`,
    `Close Reason:  ${ticket.closeReason ?? 'N/A'}`,
    `Claimed by:    ${ticket.claimedBy ?? 'Nobody'}`,
    `Priority:      ${ticket.priority}`,
    ``,
    `═══════════════════ MESSAGES ═══════════════════`,
    ``,
  ];

  for (const msg of messages) {
    if (msg.author.bot && msg.components.length > 0 && !msg.content) continue;
    const time = new Date(msg.createdTimestamp).toUTCString().slice(0, 22);
    const tag = msg.author.bot ? '[BOT]' : '';
    lines.push(`[${time}] ${tag}${msg.author.tag}: ${msg.content || '[embed/attachment]'}`);
    for (const att of msg.attachments.values()) {
      lines.push(`  📎 Attachment: ${att.url}`);
    }
  }

  lines.push(``, `═══════════════════ END ═══════════════════`);

  const content = lines.join('\n');
  const filename = `transcript-${ticket.ticketNumber}-${ticket.id.slice(0,8)}.txt`;
  const filepath = join(TRANSCRIPT_DIR, filename);
  await writeFile(filepath, content, 'utf8');

  const buffer = Buffer.from(content, 'utf8');
  return new AttachmentBuilder(buffer, { name: filename });
}
