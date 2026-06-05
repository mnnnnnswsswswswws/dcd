# UTM Setup Guide

[UTM](https://mac.getutm.app) runs full virtual machines on iOS/iPadOS using
QEMU. Compared to iSH it gives you a **real Linux kernel** — raw sockets, live
packet capture, Metasploit, and the heavier tools all work. The trade-offs are a
more involved setup and higher CPU/RAM/storage use.

> UTM is distributed outside the App Store for iOS (via the UTM site / AltStore /
> a TestFlight beta). On a recent iPhone, JIT/virtualization performance varies;
> a lightweight Alpine or Debian guest is recommended.

## 1. Install UTM

- iOS/iPadOS: install UTM from [getutm.app](https://mac.getutm.app) following
  their current instructions (AltStore sideload or TestFlight).
- Or run the same guest on a Mac with UTM from the Mac App Store to build/test.

## 2. Get a Linux guest

Easiest path — **Alpine Linux** (small, fast, same `apk` as iSH so iKali behaves
identically):

1. Download the **Alpine "virt"** ISO (aarch64) from
   [alpinelinux.org/downloads](https://alpinelinux.org/downloads/).
2. In UTM: **+ → Virtualize (Apple silicon) / Emulate → Linux**, attach the ISO.
3. Suggested resources: **2 GB RAM**, **2 CPU**, **8–16 GB disk**, virtio
   networking (shared/NAT).
4. Boot, log in as `root`, run `setup-alpine`, then `reboot` and remove the ISO.

Prefer a batteries-included distro? A **Kali Linux ARM64** or **Debian arm64**
image also works; iKali detects `apt` and installs accordingly.

## 3. Post-install configuration (Alpine guest)

```sh
# Enable community repo for the full tool set
sed -i 's/^#\(.*\/community\)/\1/' /etc/apk/repositories
apk update && apk add git sudo
adduser pentester && addgroup pentester wheel   # optional non-root user
```

## 4. Clone and run iKali

```sh
git clone https://github.com/mnnnnnswsswswswws/dcd ikali
cd ikali
sh setup.sh --full        # the VM can handle the full set
sh menu/menu.sh
```

## 5. What you gain over iSH

| Capability | UTM |
|------------|-----|
| `nmap -sS` SYN scans, `masscan`, `hping3`, `arp-scan` | ✅ (run as root) |
| Live packet capture (`tcpdump`, `tshark`, `ettercap`, `bettercap`) | ✅ |
| Metasploit Framework / `msfvenom` / BeEF | ✅ |
| Java tooling (`apktool`, `jadx`) | ✅ (JRE installs) |
| Faster cracking (`john`, `hashcat` CPU) | ✅ (native ARM) |

WiFi monitor mode still requires an **external USB adapter** passed to the VM,
which iOS does not support — wireless attacks remain offline-analysis only on a
phone. On a desktop UTM host with a compatible adapter, full wireless testing
works.

## 6. File sharing

Enable a **shared directory** in the VM settings (VirtFS/SPICE) to move APKs,
pcaps, and reports between iOS and the guest.

## 7. Snapshots

Take a UTM snapshot after a clean `setup.sh --full` so you can roll back to a
known-good lab state between engagements.
