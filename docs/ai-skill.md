# Clash Royale Companion skill

`clash-royale-companion/` is a skill that teaches an AI assistant to use your Companion app's API. With it,
the assistant can read your synced account, give advice based on your real card levels and battles, and save
decks and notes back to the app.

## Install in Claude Code

Copy the folder into a skills directory:

```sh
# For all your projects
mkdir -p ~/.claude/skills
cp -r .claude/skills/clash-royale-companion ~/.claude/skills/

# Inside this repo it already lives at .claude/skills/ and loads automatically
```

Restart Claude Code. The skill loads when you ask about your Clash Royale account. You can also invoke it
directly with `/clash-royale-companion`.

For the Claude apps, zip the `clash-royale-companion` folder and upload it under Settings, Capabilities,
Skills. The assistant needs network access to your app's URL.

## Configure

1. Log in to the app, open **Settings**, and create an API key. It starts with `crk_` and is shown only once.
2. In the skill folder, copy `.env.example` to `.env` and fill in both values:

```sh
CR_COMPANION_URL=https://cr.example.com
CR_COMPANION_API_KEY=crk_...
```

Environment variables with the same names take precedence, so you can also export them from your shell
profile instead. Keep `.env` out of version control. The skill loads the key without printing it.

The key can read and change your players, decks and notes. It cannot manage API keys. Revoke it on the
Settings page if it leaks.

## Try it

- "How did my Hog deck do this week?"
- "Which cards should I upgrade next with a limited gold budget?"
- "Build me a Path of Legend deck from cards I have at level 14 or higher, and save it."
