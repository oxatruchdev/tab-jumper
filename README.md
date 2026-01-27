# Tab Jumper

![Tab Jumper](tab-jumper.png)

A Firefox extension that replicates the quick tab-switching experience from Brave/Chrome, with Vim motions because I love Vim.

The shortcut is `Ctrl+Shift+Space` — I found that to be comfortable enough, you can change it later for whatever you like.

## Features

- Fuzzy search across tab titles and domains, similar to Brave's tab search
- Domain-first ranking — prioritizes matching the hostname, then the title
- MRU (most recently used) tab ordering
- Highlights matched characters in search results
- Recently closed tabs — search and restore them instantly
- Audible tab indicators

## Navigation

| Key                     | Action                 |
| ----------------------- | ---------------------- |
| `Arrow Up` / `Ctrl+K`   | Move up                |
| `Arrow Down` / `Ctrl+J` | Move down              |
| `Enter` / `Ctrl+L`      | Switch to selected tab |
| `Escape`                | Close popup            |

I decided to create this app (with the help of claude and chatgpt) because I couldn't find something even close to the behavior and the snappiness I was looking for, this does it with its quirks.

PRs are open or you can just fork it and change it to whatever you like.

---

## TODO / Nice-to-have additions

- **Window-aware ranking**
  - Prefer MRU tabs from the current window over other windows
  - Still allow cross-window switching

- **Sidebar mode**
  - Optional sidebar instead of popup
  - Better focus reliability and more space

- **Search behavior options**
  - Toggle domain-first vs title-first weighting
  - Toggle fuzzy vs substring-only matching

- **Performance**
  - Cache normalized strings for faster scoring
  - Cap MRU list size per window

- **Accessibility**
  - Better ARIA roles
  - Screen-reader friendly announcements

---

## License

MIT License
