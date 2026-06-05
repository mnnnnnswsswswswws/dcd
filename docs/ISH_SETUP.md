# iSH Setup Guide

[iSH](https://ish.app) runs a real **Alpine Linux** userland on your iPhone/iPad
by emulating x86 — no jailbreak, straight from the App Store. It's the easiest
way to run iKali, with the trade-off that some tools needing raw sockets, kernel
features, or hardware access are limited (the installer handles this for you).

## 1. Install iSH

1. Open the **App Store** and install **iSH Shell** (free).
2. Launch it. You get an Alpine shell at a `#` / `$` prompt.

## 2. Update Alpine and install git

```sh
apk update
apk add git
```

If `apk` complains about repositories, enable the community repo:

```sh
echo "https://dl-cdn.alpinelinux.org/alpine/latest-stable/main" >  /etc/apk/repositories
echo "https://dl-cdn.alpinelinux.org/alpine/latest-stable/community" >> /etc/apk/repositories
apk update
```

## 3. Clone and run iKali

```sh
git clone https://github.com/mnnnnnswsswswswws/dcd ikali
cd ikali
sh setup.sh
```

Pick a profile when prompted:

- **Minimal** — base + network + web + utils (~200 MB), best first choice on iSH.
- **Standard** — adds passwords, OSINT, traffic, SSL, forensics.
- **Full** — everything that works on iSH (raw-socket/HW tools auto-skipped).

Accept the one-time **authorization** prompt (`I AGREE`).

## 4. Launch the menu

```sh
sh menu/menu.sh
```

For a nicer menu UI, install whiptail first: `apk add newt`.
After restarting the shell you can also just type `ikali`.

## 5. iSH-specific notes & limitations

| Area | What to expect on iSH |
|------|------------------------|
| **nmap** | Use `-sT --unprivileged` (TCP connect). SYN scans (`-sS`) need raw sockets and won't work. iKali's scripts do this automatically. |
| **masscan / hping3 / arp-scan / zmap** | Skipped — require raw sockets. |
| **Live capture** | `tcpdump`/`tshark` live capture is limited; analyzing saved `.pcap` files works fully (`tcpdump -r`, `tshark -r`). |
| **Metasploit / BeEF** | Impractical (size + emulation speed). Use UTM. |
| **hashcat** | CPU-only and very slow under emulation; fine for small/teaching workloads. |
| **WiFi attacks** | No monitor-mode hardware access. `aircrack-ng` still cracks captured handshakes offline. |
| **Java tools (apktool/jadx)** | Need a JVM; impractical on iSH — use UTM. `frida`/`objection` (Python) work. |

## 6. Keep iSH alive in the background

iOS may suspend iSH when backgrounded. To keep long scans running:

- Enable **Settings → iSH → "Run in background"** style options where available.
- Play silent audio / use the location trick documented by the iSH project, or
- Run long jobs inside `tmux` so they survive UI reattachment:
  ```sh
  tmux new -s scan
  sh scripts/quick_scan.sh example.com
  # detach: Ctrl-b then d ; reattach: tmux attach -t scan
  ```

## 7. Moving files in/out

iSH integrates with the iOS **Files** app: in Files → Browse, enable the **iSH**
location. Reports written to `reports/.../report.html` can be opened or shared
from there.

## 8. Updating

```sh
cd ikali
git pull
sh scripts/update_tools.sh
```
