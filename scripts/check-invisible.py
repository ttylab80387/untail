#!/usr/bin/env python3
"""Fail if any given file contains a literal invisible character (they must be written as escapes)."""
import sys


def bad(c):
    o = ord(c)
    return (o in (0x00AD, 0x034F, 0x200B, 0x200C, 0x200D, 0x200E, 0x200F, 0x2060, 0xFEFF)
            or 0x202A <= o <= 0x202E or 0x2066 <= o <= 0x2069 or 0xE0000 <= o <= 0xE007F)


status = 0
for path in sys.argv[1:]:
    text = open(path, encoding='utf-8').read()
    for line_no, line in enumerate(text.splitlines(), 1):
        hits = [f'U+{ord(c):04X}' for c in line if bad(c)]
        if hits:
            print(f'{path}:{line_no}: {", ".join(hits)}')
            status = 1
sys.exit(status)
