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
2. Give the assistant the app URL and the key as environment variables:

```sh
export CR_COMPANION_URL=https://cr.example.com
export CR_COMPANION_API_KEY=crk_...
```

Put these lines in your shell profile, or in a `.env` file in your project or in the skill folder. Keep that
file out of version control. The skill reads the key from the environment and never prints it.

The key can read and change your players, decks and notes. It cannot manage API keys. Revoke it on the
Settings page if it leaks.

## Try it

- "How did my Hog deck do this week?"
- "Which cards should I upgrade next with a limited gold budget?"
- "Build me a Path of Legend deck from cards I have at level 14 or higher, and save it."
