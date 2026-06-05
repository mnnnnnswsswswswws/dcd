# Tool Reference

All tools registered in `lib/tools.db` — the single source of truth that also
drives the installer and menu. **137 tools** across 15 categories.

Legend for **iSH**: ✅ works · ⚠️ partial/limited · ❌ needs raw sockets, a
kernel feature, or hardware not available under iSH (use UTM).

Install method: `apk`/`apt` (system package), `pip` (Python --user), `go`
(go install), `gem` (Ruby), `git` (clone to `~/.ikali/src`), `source` (build),
`special` (custom installer / needs JVM etc.).

## Base System

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `curl` | apk | ✅ | Transfer data from URLs |
| `wget` | apk | ✅ | Network downloader |
| `git` | apk | ✅ | Version control / clone tools |
| `python3` | apk | ✅ | Python 3 interpreter |
| `py3-pip` | apk | ✅ | Python package installer |
| `ruby` | apk | ✅ | Ruby interpreter |
| `go` | apk | ⚠️ | Go toolchain (slow under emulation) |
| `perl` | apk | ✅ | Perl interpreter |
| `tmux` | apk | ✅ | Terminal multiplexer |
| `vim` | apk | ✅ | Text editor |
| `jq` | apk | ✅ | JSON processor |
| `tar` | apk | ✅ | Archive utility |
| `unzip` | apk | ✅ | Zip extractor |
| `build-base` | apk | ⚠️ | Compiler toolchain for source builds |

## Scanning & Enumeration

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `nmap` | apk | ⚠️ | Network/port scanner (use -sT on iSH) |
| `nmap-scripts` | apk | ✅ | Nmap NSE script library |
| `masscan` | apk | ❌ | Mass IP port scanner (needs raw sockets) |
| `netcat` | apk | ✅ | TCP/IP swiss-army knife |
| `socat` | apk | ✅ | Multipurpose relay |
| `hping3` | apk | ❌ | Packet crafter (needs raw sockets) |
| `mtr` | apk | ⚠️ | Traceroute + ping combined |
| `arp-scan` | apk | ❌ | ARP host discovery (raw sockets) |
| `netdiscover` | source | ❌ | Active/passive ARP recon |
| `fping` | apk | ⚠️ | Fast multi-host ping |
| `nbtscan` | apk | ✅ | NetBIOS name scanner |
| `onesixtyone` | source | ✅ | SNMP community scanner |
| `snmp` | apk | ✅ | Net-SNMP tools (snmpwalk) |
| `p0f` | apk | ⚠️ | Passive OS fingerprinting |
| `zmap` | source | ❌ | Internet-wide scanner (raw sockets) |
| `tcptraceroute` | apk | ⚠️ | TCP-based traceroute |

## Web Application Testing

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `nikto` | apk | ✅ | Web server vulnerability scanner |
| `sqlmap` | pip | ✅ | Automatic SQL injection tool |
| `dirb` | apk | ✅ | Web content brute-forcer |
| `gobuster` | go | ⚠️ | Directory/DNS/vhost brute-forcer |
| `feroxbuster` | apk | ⚠️ | Recursive content discovery |
| `wfuzz` | pip | ✅ | Web application fuzzer |
| `ffuf` | go | ⚠️ | Fast web fuzzer |
| `httpie` | apk | ✅ | Human-friendly HTTP client |
| `whatweb` | gem | ✅ | Web technology fingerprinter |
| `wafw00f` | pip | ✅ | Web application firewall detector |
| `wpscan` | gem | ✅ | WordPress security scanner |
| `joomscan` | git | ✅ | Joomla vulnerability scanner |
| `nuclei` | go | ⚠️ | Template-based vulnerability scanner |
| `xsser` | pip | ✅ | Cross-site scripting detection |
| `commix` | git | ✅ | Command injection exploiter |
| `dalfox` | go | ⚠️ | XSS scanner and parameter analyzer |

## Password Attacks

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `hydra` | apk | ✅ | Network login brute-forcer |
| `medusa` | apk | ✅ | Parallel login brute-forcer |
| `john` | apk | ✅ | John the Ripper password cracker |
| `hashcat` | apk | ⚠️ | GPU/CPU hash cracker (slow on iSH) |
| `crunch` | apk | ✅ | Wordlist generator |
| `cewl` | gem | ✅ | Custom wordlist spider |
| `cupp` | git | ✅ | Common user password profiler |
| `patator` | pip | ✅ | Multi-purpose brute-forcer |
| `ncrack` | apk | ⚠️ | High-speed network auth cracker |
| `hash-identifier` | pip | ✅ | Identify hash types |

## OSINT & Recon

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `bind-tools` | apk | ✅ | DNS lookup utilities (dig/host) |
| `whois` | apk | ✅ | Domain registration lookup |
| `dnsenum` | git | ✅ | DNS enumeration |
| `dnsrecon` | pip | ✅ | DNS reconnaissance |
| `fierce` | pip | ✅ | DNS subdomain scanner |
| `sublist3r` | pip | ✅ | Subdomain enumeration via OSINT |
| `amass` | go | ⚠️ | In-depth attack surface mapping |
| `subfinder` | go | ⚠️ | Passive subdomain discovery |
| `theharvester` | pip | ✅ | Email/subdomain/host harvester |
| `recon-ng` | pip | ✅ | Web reconnaissance framework |
| `sherlock` | git | ✅ | Hunt usernames across social networks |
| `spiderfoot` | pip | ✅ | OSINT automation framework |
| `metagoofil` | git | ✅ | Document metadata harvester |

## Traffic Analysis

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `tshark` | apk | ⚠️ | Wireshark CLI capture/analyzer |
| `wireshark` | apk | ⚠️ | Network protocol analyzer |
| `tcpdump` | apk | ⚠️ | Command-line packet capture |
| `ettercap` | apk | ❌ | MITM/sniffing suite (raw sockets) |
| `bettercap` | apk | ❌ | Network attack/monitoring (raw sockets) |
| `mitmproxy` | pip | ✅ | Interactive HTTPS proxy |
| `dsniff` | apk | ❌ | Password sniffing tools |
| `ngrep` | apk | ⚠️ | Network packet grep |
| `tcpflow` | apk | ⚠️ | TCP stream reassembly |
| `driftnet` | source | ❌ | Image sniffer (raw sockets) |

## Exploitation

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `metasploit` | special | ⚠️ | Exploitation framework (UTM recommended) |
| `exploitdb` | git | ✅ | Exploit-DB archive + searchsploit |
| `impacket` | pip | ✅ | Network protocol toolkit |
| `crackmapexec` | pip | ✅ | Swiss-army knife for AD/networks |
| `responder` | git | ⚠️ | LLMNR/NBT-NS/MDNS poisoner |
| `evil-winrm` | gem | ✅ | WinRM shell for pentesting |
| `powersploit` | git | ✅ | PowerShell post-exploitation (scripts) |

## Wireless (offline)

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `aircrack-ng` | apk | ❌ | WiFi security auditing suite |
| `reaver` | source | ❌ | WPS PIN brute-force |
| `pixiewps` | source | ❌ | Offline WPS pixie-dust attack |
| `wifite` | git | ❌ | Automated wireless auditor |
| `kismet` | apk | ❌ | Wireless network detector/sniffer |
| `hostapd` | apk | ❌ | Access point daemon |
| `dnsmasq` | apk | ⚠️ | DNS/DHCP for rogue AP |
| `mdk4` | source | ❌ | WiFi testing/DoS toolkit |

## Reverse Engineering

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `radare2` | apk | ✅ | Reverse engineering framework |
| `gdb` | apk | ✅ | GNU debugger |
| `binwalk` | apk | ✅ | Firmware analysis tool |
| `binutils` | apk | ✅ | strings/objdump/nm utilities |
| `ltrace` | apk | ⚠️ | Library call tracer |
| `strace` | apk | ⚠️ | System call tracer |
| `upx` | apk | ✅ | Executable packer/unpacker |

## Forensics

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `foremost` | apk | ✅ | File carving/recovery |
| `volatility3` | pip | ✅ | Memory forensics framework |
| `exiftool` | apk | ✅ | Metadata reader/writer |
| `steghide` | apk | ✅ | Steganography hide/extract |
| `stegseek` | source | ✅ | Fast steghide cracker |
| `foremost-scalpel` | apk | ✅ | File carving by headers |

## SSL/TLS & Crypto

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `openssl` | apk | ✅ | TLS/crypto toolkit |
| `sslscan` | apk | ✅ | TLS cipher/config scanner |
| `sslyze` | pip | ✅ | Fast TLS configuration analyzer |
| `testssl` | git | ✅ | TLS/SSL server tester |
| `hashid` | pip | ✅ | Hash type identifier |
| `fcrackzip` | apk | ✅ | Zip password cracker |
| `gnupg` | apk | ✅ | GnuPG encryption/signing |
| `john-zip2john` | apk | ✅ | Extract zip hashes for John |

## Mobile Testing

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `apktool` | special | ⚠️ | APK reverse engineering (needs Java) |
| `jadx` | special | ⚠️ | DEX to Java decompiler (needs Java) |
| `frida-tools` | pip | ⚠️ | Dynamic instrumentation toolkit |
| `objection` | pip | ⚠️ | Runtime mobile exploration |
| `android-tools` | apk | ⚠️ | ADB / fastboot |

## Tunneling & Payloads

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `beef-xss` | special | ❌ | Browser exploitation framework (UTM) |
| `msfvenom` | special | ⚠️ | Payload generator (with metasploit) |
| `chisel` | go | ⚠️ | TCP/UDP tunnel over HTTP |
| `socat-relay` | apk | ✅ | Relay/port-forward for pivoting |
| `ligolo` | go | ⚠️ | Reverse tunneling pivot |

## Reporting

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `pipal` | git | ✅ | Password analysis reporting |
| `cutycapt` | apk | ❌ | Web page to image (needs X) |
| `wkhtmltopdf` | apk | ⚠️ | HTML to PDF renderer |
| `aha` | apk | ✅ | ANSI terminal output to HTML |

## Utilities

| Tool | Install | iSH | Description |
|------|---------|-----|-------------|
| `proxychains-ng` | apk | ✅ | Force connections through proxies |
| `tor` | apk | ✅ | Anonymity network client |
| `screen` | apk | ✅ | Terminal session manager |
| `openssh` | apk | ✅ | SSH client/server |
| `rsync` | apk | ✅ | File synchronization |
| `nano` | apk | ✅ | Simple text editor |
| `htop` | apk | ✅ | Interactive process viewer |
| `ncat` | apk | ✅ | Nmap's netcat with TLS |

---

Total: **137** tools.
