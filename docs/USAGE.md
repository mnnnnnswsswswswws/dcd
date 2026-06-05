# Usage Guide & Workflows

All examples assume you are in the iKali directory and have run `setup.sh`.
**Only run these against systems you are authorized to test** (see LEGAL.md).

## The menu

```sh
sh menu/menu.sh      # or: ikali  (after restarting your shell)
```

Pick a category → pick a tool. Installed tools are marked `*` / `[on]`. Choosing
a tool shows its location, lets you enter arguments, or prints its help. The
**Recently used** entry tracks your last tools.

## Automated workflows

### Full recon of one target
```sh
sh scripts/quick_scan.sh example.com
sh scripts/quick_scan.sh -p full -o reports/acme 10.10.10.5
sh scripts/quick_scan.sh -t example.com          # route through Tor
```
Runs DNS → nmap ports/services → nmap vuln scripts → web enumeration (if a web
port is open) → HTML report at `reports/<target>_<timestamp>/report.html`.

### Map a network
```sh
sh scripts/network_map.sh 192.168.1.0/24
```
Discovers live hosts (TCP-connect sweep on iSH), scans top ports, reports.

### Enumerate a web app
```sh
sh scripts/web_enum.sh https://example.com
sh scripts/web_enum.sh -w /usr/share/seclists/Discovery/Web-Content/big.txt https://example.com
```
whatweb fingerprint → wafw00f → nikto → directory brute-force (gobuster/ffuf/dirb).

### Vulnerability assessment
```sh
sh scripts/vuln_check.sh example.com
```
nuclei templates + nmap `vuln` NSE category → report.

### Update everything
```sh
sh scripts/update_tools.sh           # system + git tools + nuclei templates
sh scripts/update_tools.sh --dry-run
```

## Manual tool recipes

### nmap (note the iSH flags)
```sh
# iSH (no raw sockets):
nmap -sT -Pn --unprivileged -sV --top-ports 1000 <target>
# UTM/native as root:
nmap -sS -Pn -sV -sC -p- <target>
nmap -Pn --script vuln <target>
```

### Wireshark / tshark on a capture
```sh
tshark -r capture.pcap -Y 'http.request' -T fields -e http.host -e http.request.uri
tcpdump -r capture.pcap -nn 'tcp port 80'
```

### Web: directory + SQLi + fuzzing
```sh
gobuster dir -u https://target -w wordlists/custom/web_paths.txt
sqlmap -u 'https://target/item?id=1' --batch --risk 2 --level 3
ffuf -u https://target/FUZZ -w wordlists/custom/web_paths.txt
nuclei -u https://target -severity high,critical
```

### Passwords (authorized accounts only)
```sh
hydra -L wordlists/custom/common_usernames.txt -P wordlists/custom/common_passwords.txt ssh://<target>
john --wordlist=wordlists/rockyou.txt hashes.txt
zip2john secret.zip > zip.hash && john zip.hash
```

### OSINT / subdomains
```sh
theHarvester -d example.com -b all
subfinder -d example.com | httpx -silent
python ~/.ikali/src/sherlock/sherlock username
```

### TLS posture
```sh
sslscan example.com:443
~/.local/bin/testssl.sh https://example.com
sslyze --regular example.com:443
```

### Mobile (APK pulled to the device)
```sh
frida-ps -U
objection -g com.target.app explore     # needs a frida-server on a rooted test device
```

## Anonymity with Tor + proxychains
```sh
tor -f configs/torrc &
proxychains4 nmap -sT -Pn example.com
proxychains4 curl https://check.torproject.org/
```

## Reporting

Every automated script calls `scripts/report_gen.sh` to build a single
self-contained `report.html`. Generate one manually from any results folder:
```sh
sh scripts/report_gen.sh reports/example_20260101-120000
```
Output is HTML-escaped, so noisy/hostile tool output can't break the report.

## Tips

- Run long jobs in `tmux` so they survive iOS backgrounding (see ISH_SETUP.md).
- Re-run a single category any time: `sh install/02_web.sh`.
- Check what's installed: `sh tests/test_install.sh`.
- Logs: `~/.ikali/install.log`.
