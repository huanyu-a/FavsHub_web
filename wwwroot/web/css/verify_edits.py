import sys, io, re
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

filepath = r'C:\project\wwwroot\FavsHub_web\wwwroot\web\css\main-bundle.css'
with open(filepath, 'r', encoding='utf-8') as f:
    content = f.read()
    lines = content.splitlines()

print('Final file: {} lines (was ~7855)'.format(len(lines)))
print('Lines removed: ~{}'.format(7855 - len(lines)))
print()

results = []

def check(desc, condition):
    results.append(condition)
    status = 'PASS' if condition else 'FAIL'
    print('  [{}] {}'.format(status, desc))

# 1
check('Edit 1: #toggle-view removed', '#toggle-view' not in content)

# 2
check('Edit 2: .website_url:hover removed', '.website_url:hover' not in content)

# 3
check('Edit 3: .global-range-slider removed', '.global-range-slider' not in content)

# 4
check('Edit 4: 1 .back-to-links block', content.count('.back-to-links {') == 1)

# 5
check('Edit 5: 1 .custom-engine-form', content.count('.custom-engine-form {') == 1)

# 6
check('Edit 6: .custom-checkbox complete version', 
      '.custom-checkbox {\n  position: relative;' in content)

# 7
check('Edit 7: 1 @keyframes tipFadeIn + 1 tipFadeOut',
      content.count('@keyframes tipFadeIn') == 1 and 
      content.count('@keyframes tipFadeOut') == 1)

# 8
idx = content.find('interface-elements-settings::-webkit-scrollbar-track')
snippet = content[idx:idx+200] if idx >= 0 else ''
check('Edit 8: no literal backslash-n in scrollbar-track',
      chr(92) + 'n' not in snippet)

# 9
check('Edit 9: orphaned properties removed',
      '\n  color: #ffffff;\n}\n[' not in content)

# 10
check('Edit 10: .settings-modal-content removed',
      '.settings-modal-content' not in content)

# 11
check('Edit 11: 1 standalone .suggestion-url',
      len(re.findall(r'^\.suggestion-url \{', content, re.MULTILINE)) == 1)

# 12
check('Edit 12: 1 .suggestion-dash',
      content.count('.suggestion-dash {') == 1)

# 13
check('Edit 13: .tab simple removed, complete kept',
      '.tab {\n  flex-shrink: 0;\n}' not in content and
      '.tab {\n  cursor: pointer;' in content)

# 14
check('Edit 14: empty #categories-list removed',
      '#categories-list {\n    /*' not in content)

# 15
check('Edit 15: @tailwind directives removed',
      '@tailwind' not in content)

print()
passed = sum(results)
total = len(results)
print('Results: {}/{} checks passed'.format(passed, total))
if passed == total:
    print('ALL CHECKS PASSED!')
