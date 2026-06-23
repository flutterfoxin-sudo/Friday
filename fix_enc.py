import sys
with open('C:\\Users\\hp\\OneDrive\\Desktop\\J.A.R.V.I.S\\backend\\skills\\autohedge_daemon.py', 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()
# Replace corrupted em-dashes if any
content = content.replace('\x97', '—')
with open('C:\\Users\\hp\\OneDrive\\Desktop\\J.A.R.V.I.S\\backend\\skills\\autohedge_daemon.py', 'w', encoding='utf-8') as f:
    f.write(content)
