import shutil
import sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

filepath = r'C:\project\wwwroot\FavsHub_web\wwwroot\web\css\main-bundle.css'

# Create backup
shutil.copy2(filepath, filepath + '.bak')
print("Backup created.")

with open(filepath, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Original line count: {len(lines)}")

# All ranges to remove (0-indexed, exclusive end)
# Ordered from BOTTOM to TOP for safe removal
removals = [
    # Edit 4: First .back-to-links block (lines 6372-6398, 1-indexed)
    (6371, 6398, "Edit 4: Remove first .back-to-links block"),
    # Edit 9: Orphaned CSS properties (lines 5420-5421)
    (5419, 5421, "Edit 9: Remove orphaned CSS properties"),
    # Edit 10: Dead .settings-modal-content (lines 4926-4932)
    (4925, 4932, "Edit 10: Remove dead settings-modal-content"),
    # Edit 14: Empty #categories-list (lines 4451-4455)
    (4450, 4455, "Edit 14: Remove empty #categories-list"),
    # Edit 15: @tailwind directives (lines 4413-4416)
    (4412, 4416, "Edit 15: Remove @tailwind directives"),
    # Edit 3: .global-range-slider block (lines 4254-4327)
    (4253, 4327, "Edit 3: Remove dead .global-range-slider rules"),
    # Edit 5: First .custom-engine-form (lines 4081-4091)
    (4080, 4091, "Edit 5: Remove duplicate .custom-engine-form"),
    # Edit 6: Simple .custom-checkbox (lines 4061-4064)
    (4060, 4064, "Edit 6: Remove duplicate .custom-checkbox"),
    # Edit 7b: Second @keyframes tipFadeIn+tipFadeOut (lines 3457-3485)
    (3456, 3485, "Edit 7b: Remove 2nd duplicate @keyframes tipFade*"),
    # Edit 7a: First @keyframes tipFadeIn+tipFadeOut (lines 3235-3256)
    (3234, 3256, "Edit 7a: Remove 1st duplicate @keyframes tipFade*"),
    # Edit 12+11b: Second .suggestion-dash + second .suggestion-url (lines 2260-2269)
    (2259, 2269, "Edit 11b+12: Remove 2nd dup .suggestion-dash + .suggestion-url"),
    # Edit 11a+12a: First .suggestion-url + first .suggestion-dash (lines 2242-2250)
    (2241, 2250, "Edit 11a+12a: Remove 1st dup .suggestion-url + .suggestion-dash"),
    # Edit 2: .website_url:hover (lines 1873-1876)
    (1872, 1876, "Edit 2: Remove dead .website_url:hover"),
    # Edit 1: #toggle-view blocks (lines 1841-1857)
    (1840, 1857, "Edit 1: Remove dead #toggle-view rules"),
    # Edit 13: Simple .tab (lines 1791-1795)
    (1790, 1795, "Edit 13: Remove duplicate .tab"),
]

# Verify ranges don't overlap
for i in range(len(removals)):
    for j in range(i+1, len(removals)):
        s1, e1, _ = removals[i]
        s2, e2, _ = removals[j]
        if s1 < e2 and s2 < e1:
            print(f"OVERLAP DETECTED: {removals[i][2]} and {removals[j][2]}")

# Print what will be removed for verification
total_removed = 0
for start, end, desc in removals:
    count = end - start
    total_removed += count
    print(f"  {desc}: lines {start+1}-{end} ({count} lines)")
    # Print first and last line of the range for verification
    first_line = lines[start].strip()[:80]
    last_line = lines[end-1].strip()[:80]
    print(f"    First: {first_line}")
    print(f"    Last:  {last_line}")

print(f"\nTotal lines to remove: {total_removed}")

# Apply removals from bottom to top
for start, end, desc in removals:
    del lines[start:end]
    print(f"  Removed: {desc}")

# Edit 8: Fix broken CSS at original line 5367
# After removing ranges above line 5367, the line shifts
# Ranges above 5367: (6371,6398) is below, (5419,5421) is below
# No ranges above 5367, so the line is still at index 5366
fix_idx = 5366
old_line = lines[fix_idx]
print(f"\nEdit 8: Fixing broken CSS at line {fix_idx+1}")
print(f"  Before: {repr(old_line)}")
# Replace literal \n (backslash-n) with actual newline
lines[fix_idx] = old_line.replace('\\n', '\n')
print(f"  After:  {repr(lines[fix_idx])}")

# Verify line 5368 (now a separate line after the fix)
print(f"  Next line: {repr(lines[fix_idx+1])}")

with open(filepath, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f"\nNew line count: {len(lines)}")
print(f"Lines removed: {len(lines) - (len(lines) + total_removed)}")
print("All edits applied successfully!")
