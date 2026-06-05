# iKali — Linux Penetration Testing Toolkit for iPhone

```
   _ _  __     _ _
  (_) |/ /__ _| (_)
  | | ' </ _` | | |
  |_|_|\_\__,_|_|_|   Linux pentest toolkit for iPhone
```

![platform](https://img.shields.io/badge/platform-iSH%20%7C%20UTM%20%7C%20Alpine-blue)
![shell](https://img.shields.io/badge/shell-POSIX%20sh-green)
![tools](https://img.shields.io/badge/tools-137%2B-orange)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

A modular installer and launcher that turns a Linux environment **on your iPhone**
into a working penetration-testing lab — **nmap, Wireshark (tshark), sqlmap,
Metasploit, aircrack-ng, hydra, nuclei, frida** and 130+ more — with an
interactive menu, automated recon scripts, and HTML reporting.

Runs without a jailbreak via **iSH** (Alpine Linux from the App Store) or a full
Linux VM in **UTM**. The installer auto-detects the environment and adapts:
tools that need raw sockets or special hardware are skipped on iSH with a clear
note instead of failing.

> ⚠️ **Authorized use only.** These tools are for systems you own or have
> **written permission** to test (lab/CTF/engagements). Unauthorized scanning or
> access is illegal. See [docs/LEGAL.md](docs/LEGAL.md). On first run you must
> accept the authorization prompt.

---

## Quick start

**On iSH** (see [docs/ISH_SETUP.md](docs/ISH_SETUP.md) for the full guide):

```sh
apk update && apk add git
git clone https://github.com/mnnnnnswsswswswws/dcd ikali
cd ikali
sh setup.sh            # interactive: pick a profile
sh menu/menu.sh        # launch the tool menu  (or just: ikali)
```

**On UTM** (full VM, all tools): see [docs/UTM_SETUP.md](docs/UTM_SETUP.md).

Non-interactive installs:

```sh
sh setup.sh --minimal     # base + network + web + utils  (~200 MB)
sh setup.sh --standard    # + passwords, OSINT, traffic, SSL, forensics
sh setup.sh --full        # everything, 137+ tools
sh setup.sh --dry-run     # show what would be installed, change nothing
```

---

## Environment support

| Capability        | iSH        | UTM / aarch64 | Native Alpine |
|-------------------|------------|---------------|---------------|
| apk / pip / gem   | ✅         | ✅            | ✅            |
| Raw sockets (SYN) | ❌ (use -sT) | ✅          | ✅            |
| Live packet capture | limited  | ✅            | ✅            |
| Metasploit / BeEF | impractical | ✅           | ✅            |
| WiFi monitor mode | ❌ (no HW) | ❌ (no HW)    | ✅ (w/ adapter)|
| Offline analysis (pcap, hashes, stego) | ✅ | ✅ | ✅ |

The toolkit always installs what works and explains what doesn't.

---

## Tool categories

| Category | Count | Highlights |
|----------|-------|-----------|
| Scanning & enumeration | 16 | nmap, masscan, netcat, mtr, fping |
| Web application testing | 16 | sqlmap, nikto, gobuster, ffuf, nuclei, wpscan |
| OSINT & recon | 13 | amass, theHarvester, sublist3r, recon-ng, sherlock |
| Traffic analysis | 10 | tshark, tcpdump, mitmproxy, ettercap, ngrep |
| Password attacks | 10 | hydra, john, hashcat, medusa, crunch |
| Wireless (offline) | 8 | aircrack-ng, kismet, hostapd |
| SSL/TLS & crypto | 8 | sslscan, sslyze, testssl.sh, openssl |
| Exploitation | 7 | metasploit, impacket, crackmapexec, searchsploit |
| Reverse engineering | 7 | radare2, gdb, binwalk, ltrace, strace |
| Forensics | 6 | volatility3, foremost, exiftool, steghide |
| Mobile testing | 5 | frida, objection, apktool, jadx, adb |
| Tunneling & payloads | 5 | chisel, ligolo-ng, socat, msfvenom |
| Reporting | 4 | report_gen, pipal, aha, wkhtmltopdf |
| Utilities | 8 | proxychains, tor, screen, ssh |
| **Base** | 14 | python, ruby, go, git, tmux, jq |

Full reference with install method and iSH compatibility: [docs/TOOLS.md](docs/TOOLS.md).

---

## Automated workflows

```sh
sh scripts/quick_scan.sh   example.com          # recon: ports + services + vuln + web
sh scripts/network_map.sh  192.168.1.0/24        # discover live hosts + top ports
sh scripts/web_enum.sh     https://example.com   # whatweb + nikto + dir brute-force
sh scripts/vuln_check.sh   example.com           # nuclei + nmap vuln scripts
sh scripts/update_tools.sh                       # update everything
```

Every script **validates its input** (hostname / IPv4 / CIDR / URL whitelist) to
prevent command injection, and writes a self-contained **HTML report** you can
open in the iOS Files app.

---

## Anonymized traffic (Tor)

```sh
tor -f configs/torrc &
proxychains4 nmap -sT -Pn example.com
proxychains4 curl https://check.torproject.org/
```

---

## Repository layout

```
setup.sh            Master installer (profiles, env-detect, progress)
lib/common.sh       Shared library: logging, detection, safe_download, validation
lib/tools.db        Single source of truth for all 137 tools
install/NN_*.sh     15 modular category installers
menu/menu.sh        Interactive TUI launcher (whiptail/dialog/plain fallback)
scripts/*.sh        Automated recon + reporting workflows
configs/            proxychains, tor, nmap profiles
wordlists/          Downloader + bundled small lists
tests/              Syntax, registry and injection tests
docs/               Setup guides, tool reference, legal
```

---

## Security of the toolkit itself

The installer and scripts are hardened: **HTTPS-only downloads with SHA-256
verification**, strict **input validation** against command injection, **least
privilege** (`pip --user`, `go install` to `$HOME`, root only for the package
manager), **no secrets or telemetry**, contained state under `~/.ikali` (mode
`700`), and a passing **injection test suite** (`tests/test_scripts.sh`).

---

## License

MIT — see [LICENSE](LICENSE). Use responsibly and legally.
