#!/usr/bin/env python3
import os
import sys
import struct
import glob

def compile_po_to_mo(po_content):
    lines = po_content.splitlines()
    messages = {}
    current_msgid = None
    current_msgstr = None
    state = None

    for line in lines:
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if line.startswith('msgid '):
            if current_msgid is not None and current_msgstr is not None:
                messages[current_msgid] = current_msgstr
            current_msgid = line[6:].strip('"')
            state = 'msgid'
        elif line.startswith('msgstr '):
            current_msgstr = line[7:].strip('"')
            state = 'msgstr'
        elif line.startswith('"') and state == 'msgid':
            current_msgid += line.strip('"')
        elif line.startswith('"') and state == 'msgstr':
            current_msgstr += line.strip('"')

    if current_msgid is not None and current_msgstr is not None:
        messages[current_msgid] = current_msgstr

    keys = sorted(messages.keys())
    magic = 0x950412de
    num_strings = len(keys)

    orig_table = []
    trans_table = []
    orig_offset = 7 * 4 + num_strings * 8 * 2
    trans_offset = orig_offset + sum(len(k.encode('utf-8')) + 1 for k in keys)

    cur_orig = orig_offset
    cur_trans = trans_offset
    for k in keys:
        kb = k.encode('utf-8')
        orig_table.append((len(kb), cur_orig))
        cur_orig += len(kb) + 1

        vb = messages[k].encode('utf-8')
        trans_table.append((len(vb), cur_trans))
        cur_trans += len(vb) + 1

    header = struct.pack('Iiiiiii', magic, 0, num_strings, 7 * 4, 7 * 4 + num_strings * 8, 0, 0)
    orig_data = b''.join(struct.pack('ii', l, o) for l, o in orig_table)
    trans_data = b''.join(struct.pack('ii', l, o) for l, o in trans_table)
    orig_strings = b''.join(k.encode('utf-8') + b'\x00' for k in keys)
    trans_strings = b''.join(messages[k].encode('utf-8') + b'\x00' for k in keys)

    return header + orig_data + trans_data + orig_strings + trans_strings

def main():
    po_dir = 'po'
    target_base = sys.argv[1] if len(sys.argv) > 1 else 'src/locale'

    if not os.path.exists(po_dir):
        print(f"No {po_dir} directory found.")
        return

    po_files = glob.glob(os.path.join(po_dir, '*.po'))
    if not po_files:
        print("No .po translation files found.")
        return

    for po_path in po_files:
        lang = os.path.splitext(os.path.basename(po_path))[0]
        out_dir = os.path.join(target_base, lang, 'LC_MESSAGES')
        os.makedirs(out_dir, exist_ok=True)
        out_mo = os.path.join(out_dir, 'rezmon.mo')

        with open(po_path, 'r', encoding='utf-8') as f:
            mo_bytes = compile_po_to_mo(f.read())

        with open(out_mo, 'wb') as f:
            f.write(mo_bytes)

        print(f"Compiled {po_path} -> {out_mo} ({len(mo_bytes)} bytes)")

if __name__ == '__main__':
    main()
