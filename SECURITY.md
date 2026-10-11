# Security Policy

## Supported versions

Only the latest release receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's
[private vulnerability reporting](https://github.com/VitoorFranca/spokemark/security/advisories/new)
for this repository, or contact the maintainer privately through the email on
[@VitoorFranca](https://github.com/VitoorFranca)'s profile.

Include the affected version, steps to reproduce, and the impact you observed.
You should get an acknowledgement within a few days.

## Scope notes

Spokemark processes audio locally and stores only text (in `~/Library/Application Support/Spokemark`).
Of particular interest:

- anything that could make audio or transcripts leave the device;
- IPC validation bypasses between the sandboxed renderers and the main process;
- the native helpers (`audiotap`, `whisper-worker`) and their stdin/stdout protocols;
- model download integrity (SHA-256 verification).
