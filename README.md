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

1. Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications). Enable **Message Content Intent** in the Bot section.
2. Save the bot token in **Setup → Connect Discord** in the Fyso panel.
3. Run `mise run discord:invite` and open the URL to invite the bot to your guild.
4. Enable Discord Developer Mode, copy the channel ID and run
   `mise run discord:add <channel-id> <bot-id>`. Use the agent ID from your project.
5. Commit `project/discord.yaml` and run `mise run discord:check` and `mise run doctor`.

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

## Development

Run `npm ci --prefix extensions/discord`, then `npm test`. With Copier 9.19.1
and pytest available, run `python3 -m pytest tests/test_packaging.py -q`.
