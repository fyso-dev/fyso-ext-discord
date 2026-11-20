# Fyso Discord extension

Connect an OpenMausBot agent to Discord. Mention the Discord bot in an enabled
channel to start a thread, then carry on talking in the thread.

## Install and configure

From a generated Fyso project, install this local Git repository and keep it
available for updates. Start the project before installing so the Setup panel
is available to save the required token. For a stopped project with Discord
already installed, set the token using `mise run secrets` before starting it. Copier records the install source in its answers file.

```sh
mise run ext:add <path-to-fyso-ext-discord> -- --vcs-ref HEAD
```

1. In the [Discord Developer Portal](https://discord.com/developers/applications), create an application. In its **Bot** section copy the token and turn on **Message Content Intent**.
2. Paste the token in **Setup → Connect Discord** in the Fyso panel.
3. Open the panel's **Discord** page. Step 1 shows the bot's state and one
   invite button; step 2 is where you choose which agent answers in which channel
   and whether it answers only when mentioned or every new message.
4. Commit `project/discord.yaml` (the page writes it).

Terminal equivalents: `mise run discord:invite`, `mise run discord:add <channel-id> <bot-id>`,
`mise run discord:check`.

Discord channel access controls who can talk to the agent. Choose channels and
agents whose permissions fit the people in the channel. The bridge forwards
text, including the speaker's display name, to the project's agent. Changing a
channel's assigned agent starts a fresh agent conversation on the next message
in each existing Discord thread.

For a live smoke test, mention the bot, read its reply in the new thread and
send a follow-up without mentioning it. Check that it remembers the first turn,
that a disabled channel gets no response and that a reply over 2,000 characters
arrives complete. In Setup, check invalid and valid tokens, then restore the
working token and verify doctor.

## How it answers

The agent answers in a thread under the message, posting with its own name,
avatar and color from OpenMausBot (the single invite includes Manage Webhooks for
this). If a channel denies that permission, the bridge falls back to a card with
the agent's name; set `senderMode: card` in `project/discord.yaml` to always use it.

| | Agent identity (default) | Card (`senderMode: card`) |
|---|---|---|
| Who posts | The agent, with its own name and avatar (a channel webhook) | The Discord bot, with a box showing the agent's name, avatar and color |
| Needs | Manage Webhooks (included in the invite) | Embed Links; Attach Files for the avatar |
| When | Almost always | The channel denies webhooks, or every reply should visibly come from one bot |

```
Agent identity                  Card
┌───────────────────────┐       ┌──────────────────────────┐
│ 🟢 Run Operator  APP  │       │ 🤖 Fyso Bot  APP         │
│ Done, I checked...    │       │ ┃ 🟢 Run Operator        │
└───────────────────────┘       │ Done, I checked...       │
                                └──────────────────────────┘
```

Choose "when mentioned" for shared channels and "every new message" for a channel
dedicated to the agent. Replies inside a thread keep its conversation.

## Instructions for the agent

- **Per channel:** the channel form has an optional *Instructions* field (up to
  2,000 characters; `instructions:` in `project/discord.yaml`). The agent receives
  them at the start of each new thread and keeps them for that conversation.
  Changes apply to new threads.
- **Discord etiquette:** the extension ships a `discord` skill (short replies, no
  Markdown tables, no mentions, how to read `Name: message` turns). Turn it on for
  each agent that answers in Discord from the agent's page in the panel.

Problems show up per channel in the Discord page as one sentence with the fix.
Edits made there go to `project/discord.yaml` and the bridge picks them up
automatically. The bot token stays in **Setup**.

## Development

Run `npm ci --prefix extensions/discord`, then `npm test`. With Copier 9.19.1
and pytest available, run `python3 -m pytest tests/test_packaging.py -q`.
