# -*- coding: utf-8 -*-
with open('C:\\Users\\hp\\OneDrive\\Desktop\\J.A.R.V.I.S\\backend\\skills\\autohedge_daemon.py', 'r', encoding='utf-8') as f:
    content = f.read()

if 'import numpy as np' not in content:
    content = content.replace('import string', 'import string\nimport numpy as np')

content = content.replace("model='gemini/gemini-1.5-flash'", "model='groq/llama3-8b-8192'")

with open('C:\\Users\\hp\\OneDrive\\Desktop\\J.A.R.V.I.S\\backend\\skills\\autohedge_daemon.py', 'w', encoding='utf-8') as f:
    f.write(content)
