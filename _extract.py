import re, zlib
p = r"C:\Users\Gandafu\.dsh\attachments\v1\files\47\47402a4e536208b249fcfb835f32cfabdb81e61af984425c4be5d32995d9469c\关于举办第五届“未来杯”技术大赛的通知（盖章版）.pdf"
data = open(p,"rb").read()
streams=[]
for m in re.finditer(rb"stream\r?\n", data):
    s=m.end(); e=data.find(b"endstream", s)
    if e<0: continue
    try: streams.append(zlib.decompress(data[s:e]))
    except Exception: pass

def dec(b):
    for enc in ("gbk","utf-8","latin-1"):
        try: return b.decode(enc)
        except Exception: pass
    return ""

out=[]
for s in streams:
    if b"BT" not in s: continue
    for m in re.finditer(rb"BT(.*?)ET", s, re.S):
        blk=m.group(1); parts=[]
        for t in re.finditer(rb"\((?:\\.|[^\\()])*\)", blk):
            raw=t.group(0)[1:-1]
            raw=raw.replace(rb"\(",b"(").replace(rb"\)",b")").replace(rb"\\",b"\\")
            parts.append(dec(raw))
        line="".join(parts).strip()
        if line: out.append(line)
txt="\n".join(out)
open(r"C:\Users\Gandafu\Desktop\kuangjia\pdf_text.txt","w",encoding="utf-8").write(txt)
print("lines",len(out),"chars",len(txt))
print(txt[:1200])
