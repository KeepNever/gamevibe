#!/usr/bin/env python3
"""Fix remaining template literals in Layout.tsx"""
with open('src/components/Layout.tsx', 'r', encoding='utf-8') as f:
    lines = f.readlines()

i = 0
fixed_lines = []
fix_count = 0

while i < len(lines):
    line = lines[i]
    if 'className={({ isActive }) =>' in line and '`' in line and '${' in line:
        # Collect the template literal block
        block = [line]
        i += 1
        while i < len(lines) and '`' not in lines[i]:
            block.append(lines[i])
            i += 1
        if i < len(lines):
            block.append(lines[i])
            i += 1
        if i < len(lines) and lines[i].strip() == '}':
            i += 1

        has_py25 = any('py-2.5' in b for b in block)
        indent = '                '
        suffix = "'rounded-xl text-sm font-medium py-2.5 transition-all '" if has_py25 else "'rounded-xl text-sm font-medium transition-all '"
        
        fixed_lines.append(indent + 'className={({ isActive }) => {\n')
        fixed_lines.append(indent + "  const base = 'flex items-center gap-2.5 px-3 py-2" + suffix + '\n')
        fixed_lines.append(indent + '  return isActive\n')
        fixed_lines.append(indent + "    ? base + 'bg-accent/10 text-accent shadow-sm'\n")
        fixed_lines.append(indent + "    : base + 'text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--surface-2)]'\n")
        fixed_lines.append(indent + '}\n')
        fix_count += 1
        continue
    
    fixed_lines.append(line)
    i += 1

with open('src/components/Layout.tsx', 'w', encoding='utf-8') as f:
    f.writelines(fixed_lines)

with open('src/components/Layout.tsx', 'r', encoding='utf-8') as f:
    content = f.read()
remaining = content.count('${')
print("Fixed %d blocks, remaining ${: %d" % (fix_count, remaining))
