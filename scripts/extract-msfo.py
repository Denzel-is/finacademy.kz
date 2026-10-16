"""Extract the customer's bilingual table, using only its explicit answer marks.

Run with the bundled Python runtime. Output stays in ignored .local/msfo/.
Missing keys are quarantined and never guessed or published.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET


parser = argparse.ArgumentParser()
parser.add_argument("document", type=Path)
parser.add_argument("--output", type=Path, default=Path(".local/msfo"))
args = parser.parse_args()
ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
with ZipFile(args.document) as document:
    root = ET.fromstring(document.read("word/document.xml"))
assert not root.findall(".//w:drawing", ns), "Inspect embedded images manually."
assert not root.findall(".//{http://schemas.openxmlformats.org/officeDocument/2006/math}oMath"), "Inspect equations manually."


def cell_text(cell):
    paragraphs = []
    for paragraph in cell.findall("w:p", ns):
        parts = []
        for element in paragraph.iter():
            tag = element.tag.split("}")[-1]
            if tag == "t":
                parts.append(element.text or "")
            elif tag in ("br", "cr"):
                parts.append("\n")
            elif tag == "tab":
                parts.append(" ")
        text = re.sub(r"[^\S\n]+", " ", "".join(parts)).strip()
        if text:
            paragraphs.append(text)
    return "\n".join(paragraphs)


tables = root.findall(".//w:tbl", ns)
assert len(tables) == 1, "Expected the four-column bilingual source table."
rows = tables[0].findall("w:tr", ns)
header = [cell_text(c) for c in rows[0].findall("w:tc", ns)]
assert header[0] == 'номер вопроса' and header[1] in ('правильный ответ','правильные ответы') and header[2:] == ['RU','KAZ'], header
questions = []
for row_index, row in enumerate(rows[1:], 2):
    cells = row.findall("w:tc", ns)
    assert len(cells) == 4, row_index
    number, mark, ru, kz = map(cell_text, cells)
    if number:
        assert number.isdigit() and not mark, row_index
        questions.append({"number": int(number), "RU": ru, "KZ": kz, "options": []})
    else:
        assert questions and mark in ("", "1"), row_index
        questions[-1]["options"].append({"RU": ru, "KZ": kz, "correct": mark == "1"})
assert [q["number"] for q in questions] == list(range(1, 201))
pending, valid = [], []
for q in questions:
    assert len(q["options"]) == 4, q["number"]
    assert all(q[lang] and all(o[lang] for o in q["options"]) for lang in ("RU", "KZ")), q["number"]
    count = sum(o["correct"] for o in q["options"])
    assert count <= 1, f"Multiple keys at question {q['number']}"
    (valid if count == 1 else pending).append(q)
args.output.mkdir(parents=True, exist_ok=True)


def save(name, value):
    (args.output / name).write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")


save("source.json", questions)
save("pending.json", pending)
for lang in ("RU", "KZ"):
    bank = [{
        "text": q[lang],
        "options": [{"id": chr(65 + i), "text": o[lang]} for i, o in enumerate(q["options"])],
        "correct_id": next(chr(65 + i) for i, o in enumerate(q["options"]) if o["correct"]),
    } for q in valid]
    assert len({json.dumps(q, sort_keys=True, ensure_ascii=False) for q in bank}) == len(bank), "Duplicate source records"
    save(f"{lang.lower()}.json", bank)
manifest = {
    "source_name": args.document.name,
    "sha256": hashlib.sha256(args.document.read_bytes()).hexdigest(),
    "source_count_per_language": len(questions),
    "ready_count_per_language": len(valid),
    "pending_numbers": [q["number"] for q in pending],
    "answer_source": "Explicit 1 in the source column 'правильный ответ'; same row for RU/KZ.",
}
save("manifest.json", manifest)
print(json.dumps(manifest, ensure_ascii=False))
