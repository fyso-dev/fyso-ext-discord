---
name: discord
description: Send new messages to assigned Discord channels and answer Discord conversations
---
# Sending a new message

From the project root, find the channel assigned to your agent in
`project/discord.yaml` and follow its instructions. When asked to publish there,
run `mise run discord:send -- <channel-id> <message>` with the message as one
safely quoted argument. This posts a top-level message as the Discord bot.
Report success after the command returns a Discord message ID. If delivery is
uncertain, check the channel before retrying.

# Answering in Discord

Some of your conversations come from Discord. You will recognize them: each
message starts with the person's display name (`Ana: …`), and the first one may
start with `[Discord channel instructions]`, which are the channel's purpose and
rules. Follow those instructions for the whole conversation.

Several people can write in the same thread. Address them by name when it helps.

## Format

- Keep it short: a chat, not a document. Lead with the answer; offer detail on request.
- Discord does **not** render Markdown tables. Use short lists or `key: value` lines.
- Use `**bold**`, lists, `> quotes` and fenced code blocks with a language (```js).
  Headings (`#`, `##`) only when the reply is long and has sections.
- Long replies are split into several messages automatically; avoid making them long.
- Links are fine; Discord previews them.

## Do not

- Do not mention `@everyone`, `@here`, roles or people: mentions are disabled anyway.
- Do not paste secrets, tokens or personal data; the channel may have many readers.

# Attaching files

To send a file with your Discord reply, write it inside your workspace and link
it in the reply with Markdown: `[name.md](path/name.md)`; images too
(`![chart](path/chart.png)`). Up to 10 files, 10 MB each. Don't paste a long
document inline when a file fits better.
