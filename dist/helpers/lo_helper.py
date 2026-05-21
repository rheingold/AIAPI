#!/usr/bin/env python3
"""
lo_helper.py — LibreOffice UNO socket bridge for LibreOfficeWin.exe

Connects to a running LibreOffice instance via the UNO URL resolver protocol
and exposes the same JSON stdin/stdout interface used by the C# helper pattern.

Must be run with LibreOffice's own bundled python.exe (which ships `import uno`):
    <LO_INSTALL>\\program\\python.exe lo_helper.py --port 2002 [--persistent]

Spawned automatically by LibreOfficeWin.exe when _unoSocketPort > 0 and
Marshal.GetActiveObject() fails (i.e. LibreOffice 24+ where the COM bridge
was removed).  LibreOfficeWin.exe keeps this process alive in persistent mode
and proxies each UNO-requiring command through JSON stdin/stdout.

JSON wire format (same as HelperCommon.cs RunStdinListener):
  Input  (one JSON object per line):
      {"id":"1", "target":"writer", "action":"QUERYTREE", "path":"", "value":""}
  Output (one JSON object per line):
      {"id":"1", "success":true, "result": <value_or_object>}
      {"id":"1", "success":false, "error": "reason"}

Supported actions:
  QUERYTREE  — document structure tree (depth 1-3)
  READ       — read text at path
  WRITE      — write text to path
  FORMAT     — apply character/paragraph formatting (Writer only)
  SAVE       — save document (native format)
  EXPORT     — export as PDF (or explicit .pdf path)
  LISTDOCS   — list all open documents
  _schema    — return this helper's schema
  _ping      — liveness check
  _exit      — terminate

Path conventions (matching C# LibreOfficeWin):
  Writer:  body                          — full document text
           body/para[N]                  — paragraph N (1-based)
           body/bookmark[@name='X']      — named bookmark
  Calc:    Sheet1.A1  or  A1            — single cell
           Sheet1.A1:C3  or  A1:C3      — cell range
  Impress: slide[N]                      — all text on slide N
           slide[N]/shape[M]             — shape M on slide N
"""

import sys
import json
import os
import re
import argparse

# ── Output helpers ────────────────────────────────────────────────────────────

def _emit(obj: dict):
    """Write a single JSON object to stdout and flush."""
    print(json.dumps(obj, ensure_ascii=False), flush=True)

def ok(req_id, result):
    _emit({"id": req_id, "success": True, "result": result})

def err(req_id, msg):
    _emit({"id": req_id, "success": False, "error": str(msg)})

# ── UNO connection ────────────────────────────────────────────────────────────

def connect_uno(port: int, retries: int = 10, delay: float = 1.5):
    """
    Connect to a running LibreOffice instance via UNO socket.
    Returns (desktop, ctx) on success; raises on failure.

    After RELAUNCH the TCP socket opens quickly but the UNO URL-resolver
    handshake (URP bridge) needs a few extra seconds to initialise.
    We retry up to `retries` times with `delay` seconds between attempts.
    """
    import time
    import uno  # only available inside LO's bundled python.exe
    local_ctx = uno.getComponentContext()
    resolver = local_ctx.ServiceManager.createInstanceWithContext(
        "com.sun.star.bridge.UnoUrlResolver", local_ctx)
    connect_string = (
        "uno:socket,host=localhost,port=" + str(port) + ";"
        "urp;StarOffice.ComponentContext"
    )
    last_exc = None
    for attempt in range(1, retries + 1):
        try:
            ctx = resolver.resolve(connect_string)
            smgr = ctx.ServiceManager
            desktop = smgr.createInstanceWithContext(
                "com.sun.star.frame.Desktop", ctx)
            return desktop, ctx
        except Exception as exc:
            last_exc = exc
            if attempt < retries:
                time.sleep(delay)
    raise RuntimeError(
        "UNO connect failed after " + str(retries) + " attempts "
        "on port " + str(port) + ": " + str(last_exc)
    )

# ── Document helpers ──────────────────────────────────────────────────────────

def detect_app_type(doc) -> str:
    """Detect 'writer', 'calc', 'impress', or '' from a UNO document object."""
    for service, name in (
        ("com.sun.star.text.TextDocument",              "writer"),
        ("com.sun.star.sheet.SpreadsheetDocument",      "calc"),
        ("com.sun.star.presentation.PresentationDocument", "impress"),
    ):
        try:
            if doc.supportsService(service):
                return name
        except Exception:
            pass
    return ""

def get_doc_name(doc):
    """Return (name, url) for a UNO document."""
    url = ""
    name = ""
    try:
        url = doc.getURL()
        raw = url.replace("file:///", "").replace("file://", "").replace("%20", " ")
        name = os.path.basename(raw)
    except Exception:
        pass
    if not name:
        try:
            name = doc.getCurrentController().getFrame().getName()
        except Exception:
            pass
    return name, url

def enum_open_docs(desktop):
    """Yield (doc, app_type) for every open UNO document."""
    try:
        components = desktop.getComponents()
        enum = components.createEnumeration()
        while enum.hasMoreElements():
            comp = enum.nextElement()
            try:
                c = comp.getComponent()
                if c is not None:
                    comp = c
            except Exception:
                pass
            at = detect_app_type(comp)
            if at:
                yield comp, at
    except Exception:
        pass

def find_doc(desktop, target: str):
    """
    Resolve target string to (doc, app_type).
    Returns (None, '') if no matching open document found.
    """
    t = target.lower().strip()

    if t in ("word", "writer"):
        want = "writer"
    elif t in ("excel", "calc"):
        want = "calc"
    elif t in ("impress", "powerpoint", "ppt"):
        want = "impress"
    elif t.startswith("proc:"):
        p = t[5:]
        if "calc" in p or "excel" in p:
            want = "calc"
        elif "impress" in p or "ppt" in p:
            want = "impress"
        else:
            want = "writer"
    else:
        want = t

    # DOCNAME: — search by filename
    if target.upper().startswith("DOCNAME:"):
        doc_name = target[8:]
        for doc, at in enum_open_docs(desktop):
            n, _ = get_doc_name(doc)
            if n.lower() == doc_name.lower():
                return doc, at
        return None, ""

    # Try current component first
    try:
        current = desktop.getCurrentComponent()
        if current is not None:
            at = detect_app_type(current)
            if not want or at == want:
                return current, at
    except Exception:
        pass

    # Enumerate all open docs
    for doc, at in enum_open_docs(desktop):
        if at == want:
            return doc, at

    return None, ""

# ── Column letter conversion ──────────────────────────────────────────────────

def col_to_letter(c: int) -> str:
    """0-based column index → spreadsheet column letter(s): 0→A, 25→Z, 26→AA …"""
    letters = ""
    while True:
        letters = chr(ord('A') + c % 26) + letters
        c = c // 26 - 1
        if c < 0:
            break
    return letters

# ── QUERYTREE ─────────────────────────────────────────────────────────────────

def cmd_querytree(doc, app_type: str, depth: int = 3) -> dict:
    if app_type == "writer":
        return _querytree_writer(doc, depth)
    if app_type == "calc":
        return _querytree_calc(doc, depth)
    if app_type == "impress":
        return _querytree_impress(doc, depth)
    return {}

def _querytree_writer(doc, depth: int) -> dict:
    name, url = get_doc_name(doc)
    node = {
        "id": "document",
        "type": "TextDocument",
        "name": name,
        "properties": {"path": url},
        "actions": ["READ", "WRITE", "SAVE", "EXPORT"],
    }
    if depth >= 2:
        paras = []
        try:
            text = doc.getText()
            enum = text.createEnumeration()
            idx = 1
            while enum.hasMoreElements() and idx <= 50:
                content = enum.nextElement()
                try:
                    is_para = content.supportsService(
                        "com.sun.star.text.Paragraph")
                except Exception:
                    is_para = True
                if not is_para:
                    continue
                try:
                    val = content.getString()
                except Exception:
                    val = ""
                truncated = val[:80] + ("..." if len(val) > 80 else "")
                paras.append({
                    "id":      f"para_{idx}",
                    "type":    "Paragraph",
                    "name":    f"Paragraph {idx}",
                    "value":   truncated,
                    "path":    f"body/para[{idx}]",
                    "actions": ["READ", "WRITE", "FORMAT"],
                })
                idx += 1
        except Exception as ex:
            node["_para_error"] = str(ex)
        node["children"] = paras
    return node

def _querytree_calc(doc, depth: int) -> dict:
    name, _ = get_doc_name(doc)
    try:
        sheets = doc.getSheets()
        sheet_count = sheets.getCount()
    except Exception:
        sheets = None
        sheet_count = 0
    node = {
        "id":         "spreadsheet",
        "type":       "SpreadsheetDocument",
        "name":       name,
        "properties": {"sheetCount": sheet_count},
        "actions":    ["READ", "WRITE", "SAVE", "EXPORT"],
    }
    if depth >= 2 and sheets is not None:
        children = []
        try:
            for si in range(sheet_count):
                sheet = sheets.getByIndex(si)
                sheet_name = sheet.getName()
                sheet_node: dict = {
                    "id":      f"sheet_{si + 1}",
                    "type":    "Sheet",
                    "name":    sheet_name,
                    "path":    f"sheet[@name='{sheet_name}']",
                    "actions": ["READ", "WRITE"],
                }
                if depth >= 3:
                    cells = []
                    try:
                        cursor = sheet.createCursor()
                        cursor.gotoStartOfUsedArea(False)
                        cursor.gotoEndOfUsedArea(True)
                        ra = cursor.getRangeAddress()
                        cell_count = 0
                        for r in range(ra.StartRow, ra.EndRow + 1):
                            for c in range(ra.StartColumn,
                                          ra.EndColumn + 1):
                                if cell_count >= 200:
                                    break
                                cell = sheet.getCellByPosition(c, r)
                                val = cell.getString()
                                if not val:
                                    continue
                                addr = col_to_letter(c) + str(r + 1)
                                cells.append({
                                    "id":    f"cell_{addr}",
                                    "type":  "Cell",
                                    "name":  addr,
                                    "value": val,
                                    "path":  f"sheet[@name='{sheet_name}']/{addr}",
                                    "actions": ["READ", "WRITE"],
                                })
                                cell_count += 1
                    except Exception:
                        pass
                    sheet_node["children"] = cells
                children.append(sheet_node)
        except Exception as ex:
            node["_sheet_error"] = str(ex)
        node["children"] = children
    return node

def _querytree_impress(doc, depth: int) -> dict:
    name, url = get_doc_name(doc)
    try:
        pages = doc.getDrawPages()
        slide_count = pages.getCount()
    except Exception:
        pages = None
        slide_count = 0
    node = {
        "id":         "presentation",
        "type":       "PresentationDocument",
        "name":       name,
        "properties": {"path": url, "slideCount": slide_count},
        "actions":    ["READ", "WRITE", "SAVE", "EXPORT"],
    }
    if depth >= 2 and pages is not None:
        children = []
        try:
            for si in range(slide_count):
                slide = pages.getByIndex(si)
                try:
                    slide_name = slide.Name
                except Exception:
                    slide_name = f"Slide {si + 1}"
                shape_nodes = []
                if depth >= 3:
                    for sh in range(slide.getCount()):
                        try:
                            shape = slide.getByIndex(sh)
                            t = shape.getString()
                            if not t:
                                continue
                            shape_nodes.append({
                                "id":    f"slide_{si+1}_shape_{sh+1}",
                                "type":  "Shape",
                                "name":  f"Shape {sh + 1}",
                                "value": t[:80] + (
                                    "..." if len(t) > 80 else ""),
                                "path":  f"slide[{si+1}]/shape[{sh+1}]",
                                "actions": ["READ", "WRITE"],
                            })
                        except Exception:
                            pass
                children.append({
                    "id":       f"slide_{si + 1}",
                    "type":     "Slide",
                    "name":     slide_name,
                    "path":     f"slide[{si + 1}]",
                    "actions":  ["READ", "WRITE"],
                    "children": shape_nodes,
                })
        except Exception as ex:
            node["_slide_error"] = str(ex)
        node["children"] = children
    return node

# ── READ ──────────────────────────────────────────────────────────────────────

def cmd_read(doc, app_type: str, path: str):
    if app_type == "writer":
        return _read_writer(doc, path)
    if app_type == "calc":
        return _read_calc(doc, path)
    if app_type == "impress":
        return _read_impress(doc, path)
    raise ValueError(f"Unsupported app type for READ: {app_type}")

def _writer_paragraph(text, idx: int):
    """Return 1-based paragraph from a Writer text object, or None."""
    enum = text.createEnumeration()
    n = 0
    while enum.hasMoreElements():
        content = enum.nextElement()
        try:
            is_para = content.supportsService(
                "com.sun.star.text.Paragraph")
        except Exception:
            is_para = True
        if not is_para:
            continue
        n += 1
        if n == idx:
            return content
    return None

def _read_writer(doc, path: str) -> str:
    text = doc.getText()
    if not path or path == "body":
        return text.getString()
    # body/bookmark[@name='X']
    m = re.match(
        r"body/bookmark\[@name=['\"]?([^'\"]+)['\"]?\]", path, re.I)
    if m:
        bm = doc.getBookmarks().getByName(m.group(1))
        return bm.getString()
    # body/para[N]
    m = re.match(r"body/para\[(\d+)\]", path, re.I)
    if m:
        idx = int(m.group(1))
        para = _writer_paragraph(text, idx)
        if para is None:
            raise ValueError(f"Paragraph {idx} not found")
        return para.getString()
    raise ValueError(
        f"Unsupported Writer path: {path}. "
        f"Use 'body', 'body/para[N]', or 'body/bookmark[@name=X]'.")

def _resolve_calc_sheet_cell(doc, path: str):
    """
    Resolve path to (sheet, cell_addr_str).

    Supported formats (matching C# ResolveCalcSheet):
      cell[@addr='A1']                   — first sheet, cell A1
      sheet[@name='Sheet1']/cell[@addr='B2:C5']  — named sheet + cell
      sheet[1]/cell[@addr='A1']          — sheet by 1-based index + cell
      Sheet1.A1  or  A1                  — dot-separated or bare
      Sheet1.A1:C3  or  A1:C3            — range
    """
    sheets = doc.getSheets()

    # Named sheet: sheet[@name='X']
    m_name = re.search(r"sheet\[@name=['\"]([^'\"]+)['\"]", path, re.I)
    if m_name:
        sheet = sheets.getByName(m_name.group(1))
    # Indexed sheet: sheet[N] (1-based)
    else:
        m_idx = re.search(r"sheet\[(\d+)\]", path, re.I)
        if m_idx:
            sheet = sheets.getByIndex(int(m_idx.group(1)) - 1)
        # Dot-separated: Sheet1.A1
        elif '.' in path:
            sheet_name, _ = path.split('.', 1)
            sheet = sheets.getByName(sheet_name)
        else:
            sheet = sheets.getByIndex(0)

    # Cell address: cell[@addr='X'] or bare remainder
    m_cell = re.search(r"cell\[@addr=['\"]([^'\"]+)['\"]", path, re.I)
    if m_cell:
        cell_addr = m_cell.group(1)
    else:
        # Strip sheet prefix and use whatever remains (bare addr)
        bare = re.sub(r"sheet\[[^\]]+\]/", "", path, flags=re.I)
        if '.' in bare:
            _, cell_addr = bare.split('.', 1)
        else:
            cell_addr = bare.strip()

    return sheet, cell_addr

def _read_calc(doc, path: str):
    sheet, cell_addr = _resolve_calc_sheet_cell(doc, path)
    if ':' in cell_addr:
        # Range — return list of {addr, value}
        range_obj = sheet.getCellRangeByName(cell_addr)
        ra = range_obj.getRangeAddress()
        cells = []
        for r in range(ra.StartRow, ra.EndRow + 1):
            for c in range(ra.StartColumn, ra.EndColumn + 1):
                cell = sheet.getCellByPosition(c, r)
                val = cell.getString()
                if val:
                    cells.append({
                        "addr":  col_to_letter(c) + str(r + 1),
                        "value": val,
                    })
        return cells
    return sheet.getCellRangeByName(cell_addr).getString()

def _read_impress(doc, path: str) -> str:
    pages = doc.getDrawPages()
    m = re.match(r"slide\[(\d+)\]", path, re.I)
    if not m:
        raise ValueError(
            f"Unsupported Impress path: {path}. "
            f"Use 'slide[N]' or 'slide[N]/shape[M]'.")
    slide_idx = int(m.group(1))
    if slide_idx < 1 or slide_idx > pages.getCount():
        raise ValueError(f"Slide {slide_idx} not found")
    slide = pages.getByIndex(slide_idx - 1)
    sm = re.search(r"/shape\[(\d+)\]", path, re.I)
    if sm:
        sh_idx = int(sm.group(1))
        if sh_idx < 1 or sh_idx > slide.getCount():
            raise ValueError(
                f"Shape {sh_idx} not found on slide {slide_idx}")
        return slide.getByIndex(sh_idx - 1).getString()
    # whole slide — concatenate all shape text
    parts = []
    for i in range(slide.getCount()):
        try:
            t = slide.getByIndex(i).getString()
            if t:
                parts.append(t)
        except Exception:
            pass
    return "\r\n".join(parts)

# ── WRITE ─────────────────────────────────────────────────────────────────────

def cmd_write(doc, app_type: str, path: str, value: str):
    if app_type == "writer":
        _write_writer(doc, path, value)
    elif app_type == "calc":
        _write_calc(doc, path, value)
    elif app_type == "impress":
        _write_impress(doc, path, value)
    else:
        raise ValueError(f"Unsupported app type for WRITE: {app_type}")

def _write_writer(doc, path: str, value: str):
    text = doc.getText()
    if not path or path == "body":
        cursor = text.createTextCursor()
        cursor.gotoStart(False)
        cursor.gotoEnd(True)
        text.insertString(cursor, value, True)
        return
    m = re.match(
        r"body/bookmark\[@name=['\"]?([^'\"]+)['\"]?\]", path, re.I)
    if m:
        bm = doc.getBookmarks().getByName(m.group(1))
        cursor = text.createTextCursorByRange(bm.getAnchor())
        text.insertString(cursor, value, True)
        return
    m = re.match(r"body/para\[(\d+)\]", path, re.I)
    if m:
        idx = int(m.group(1))
        para = _writer_paragraph(text, idx)
        if para is None:
            raise ValueError(f"Paragraph {idx} not found")
        cursor = text.createTextCursorByRange(para.getStart())
        cursor.gotoEndOfParagraph(True)
        text.insertString(cursor, value, True)
        return
    raise ValueError(f"Unsupported Writer write path: {path}")

def _write_calc(doc, path: str, value: str):
    sheet, cell_addr = _resolve_calc_sheet_cell(doc, path)
    cell = sheet.getCellRangeByName(cell_addr)
    if value.startswith('='):
        cell.setFormula(value)
    else:
        try:
            cell.setValue(float(value))
        except (ValueError, TypeError):
            cell.setString(value)

def _write_impress(doc, path: str, value: str):
    pages = doc.getDrawPages()
    m = re.match(r"slide\[(\d+)\]", path, re.I)
    if not m:
        raise ValueError(f"Unsupported Impress write path: {path}")
    slide_idx = int(m.group(1))
    while pages.getCount() < slide_idx:
        pages.insertNewByIndex(pages.getCount())
    slide = pages.getByIndex(slide_idx - 1)
    sm = re.search(r"/shape\[(\d+)\]", path, re.I)
    if sm:
        sh_idx = int(sm.group(1))
        if sh_idx < 1 or sh_idx > slide.getCount():
            raise ValueError(
                f"Shape {sh_idx} not on slide {slide_idx}")
        slide.getByIndex(sh_idx - 1).setString(value)
    else:
        if slide.getCount() > 0:
            slide.getByIndex(0).setString(value)
        else:
            raise ValueError(f"No shapes on slide {slide_idx}")

# ── FORMAT ────────────────────────────────────────────────────────────────────

def cmd_format(doc, app_type: str, path: str, value: str) -> dict:
    """
    Apply character/paragraph formatting to a Writer paragraph.
    path  = body/para[N]
    value = pipe-separated key=val tokens, e.g.
            "bold=true|fontsize=14|alignment=center"
            Bare tokens (no '=') are treated as named paragraph styles.
    """
    if app_type != "writer":
        raise ValueError("FORMAT is only supported for Writer documents")
    m = re.match(r"body/para\[(\d+)\]", path, re.I)
    if not m:
        raise ValueError(
            "FORMAT requires a paragraph path such as body/para[N]")
    idx = int(m.group(1))
    text = doc.getText()
    para = _writer_paragraph(text, idx)
    if para is None:
        raise ValueError(f"Paragraph {idx} not found")

    cursor = text.createTextCursorByRange(para.getStart())
    cursor.gotoEndOfParagraph(True)

    PT_TO_HMM = 35.278   # 1 pt = 35.278 (1/100 mm)
    CM_TO_HMM = 1000.0   # 1 cm = 1000 (1/100 mm)

    STYLE_MAP = {
        "Normal":         "Default Paragraph Style",
        "Heading 1":      "Heading 1",
        "Heading 2":      "Heading 2",
        "Heading 3":      "Heading 3",
        "Heading 4":      "Heading 4",
        "Heading 5":      "Heading 5",
        "Heading 6":      "Heading 6",
        "Title":          "Title",
        "Subtitle":       "Subtitle",
        "Quote":          "Quotations",
        "Intense Quote":  "Quotations",
        "List Bullet":    "List Bullet",
        "List Number":    "List Number",
        "Caption":        "Caption",
    }

    style_name = None
    applied = []
    segments = [s for s in value.split('|') if s.strip()] if value else []

    for seg in segments:
        seg = seg.strip()
        if not seg:
            continue
        if '=' not in seg:
            style_name = seg          # bare token → named paragraph style
            continue
        key, val = seg.split('=', 1)
        key = key.strip().lower()
        val = val.strip()
        b   = val.lower() in ('true', '1')

        try:
            if key == 'bold':
                cursor.setPropertyValue(
                    "CharWeight", 150.0 if b else 100.0)
            elif key == 'italic':
                cursor.setPropertyValue(
                    "CharPosture", 2 if b else 0)   # FontSlant.ITALIC / NONE
            elif key == 'underline':
                cursor.setPropertyValue(
                    "CharUnderline", 1 if b else 0)
            elif key == 'strikethrough':
                cursor.setPropertyValue(
                    "CharStrikeout", 1 if b else 0)
            elif key == 'allcaps':
                cursor.setPropertyValue(
                    "CharCaseMap", 1 if b else 0)
            elif key == 'smallcaps':
                cursor.setPropertyValue(
                    "CharCaseMap", 4 if b else 0)
            elif key == 'fontname':
                cursor.setPropertyValue("CharFontName", val)
            elif key == 'fontsize':
                cursor.setPropertyValue("CharHeight", float(val))
            elif key == 'color':
                h = val.lstrip('#')
                if len(h) == 6:
                    cursor.setPropertyValue(
                        "CharColor",
                        int(h[:2], 16) << 16 |
                        int(h[2:4], 16) << 8  |
                        int(h[4:],  16))
            elif key == 'charspacingpt':
                cursor.setPropertyValue(
                    "CharKerning",
                    int(float(val) * PT_TO_HMM))
            elif key in ('style', 'parastyle'):
                style_name = val
                continue
            elif key == 'alignment':
                adj = {'right': 1, 'justify': 2,
                       'center': 3}.get(val.lower(), 0)
                cursor.setPropertyValue("ParaAdjust", adj)
            elif key == 'spacebeforept':
                cursor.setPropertyValue(
                    "ParaTopMargin",
                    int(float(val) * PT_TO_HMM))
            elif key == 'spaceafterpt':
                cursor.setPropertyValue(
                    "ParaBottomMargin",
                    int(float(val) * PT_TO_HMM))
            elif key == 'indentleftcm':
                cursor.setPropertyValue(
                    "ParaLeftMargin",
                    int(float(val) * CM_TO_HMM))
            elif key == 'indentrightcm':
                cursor.setPropertyValue(
                    "ParaRightMargin",
                    int(float(val) * CM_TO_HMM))
            elif key == 'indentfirstlinecm':
                cursor.setPropertyValue(
                    "ParaFirstLineIndent",
                    int(float(val) * CM_TO_HMM))
            else:
                applied.append(f"?{key}")  # unknown, mark but don't error
                continue
        except Exception as prop_ex:
            applied.append(f"!{key}:{prop_ex}")
            continue
        applied.append(key)

    if style_name is not None:
        lo_style = STYLE_MAP.get(style_name, style_name)
        cursor.setPropertyValue("ParaStyleName", lo_style)
        applied.insert(0, "style")

    return {"result": "formatted", "para": idx, "applied": applied}

# ── SAVE / EXPORT ─────────────────────────────────────────────────────────────

def cmd_save(doc, app_type: str, fmt: str = "") -> dict:
    """
    Save (fmt='') or export (fmt='pdf' or absolute .pdf path) the document.
    """
    import uno as _uno

    url = ""
    try:
        url = doc.getURL()
    except Exception:
        pass
    is_new = not url or url.startswith("private:factory")

    if fmt and fmt not in ("native", ""):
        # PDF export
        filter_map = {
            "writer":  "writer_pdf_Export",
            "calc":    "calc_pdf_Export",
            "impress": "impress_pdf_Export",
        }
        filter_name = filter_map.get(app_type, "writer_pdf_Export")
        if fmt.lower().endswith(".pdf"):
            out_path = fmt
        else:
            raw_name = (url.replace("file:///", "")
                          .replace("file://", "")
                          .strip("/")) if url else "document"
            doc_stem = os.path.splitext(os.path.basename(raw_name))[0]
            out_path = os.path.join(
                os.path.expanduser("~/Documents"), doc_stem + ".pdf")
        out_url = _uno.systemPathToFileUrl(out_path)
        from com.sun.star.beans import PropertyValue  # type: ignore
        pv = PropertyValue()
        pv.Name  = "FilterName"
        pv.Value = filter_name
        doc.storeToURL(out_url, (pv,))
        return {"result": "exported", "path": out_path}

    if is_new:
        ext_map = {"writer": ".odt", "calc": ".ods", "impress": ".odp"}
        ext = ext_map.get(app_type, ".odt")
        try:
            doc_title = doc.getCurrentController().getFrame().getName()
        except Exception:
            doc_title = "document"
        save_path = os.path.join(
            os.path.expanduser("~/Documents"), doc_title + ext)
        save_url = _uno.systemPathToFileUrl(save_path)
        doc.storeToURL(save_url, ())
        return {"result": "saved", "path": save_path}

    doc.store()
    return {"result": "saved"}

# ── LISTDOCS ──────────────────────────────────────────────────────────────────

def cmd_listdocs(desktop) -> list:
    docs = []
    for doc, at in enum_open_docs(desktop):
        name, url = get_doc_name(doc)
        saved = True
        try:
            saved = not doc.isModified()
        except Exception:
            pass
        docs.append({"app": at, "name": name, "path": url, "saved": saved})
    return docs

# ── NEWDOC ───────────────────────────────────────────────────────────────────

def cmd_newdoc(desktop, app_type: str) -> dict:
    """Open a new blank document via UNO desktop.loadComponentFromURL.

    This completely bypasses the LibreOffice Impress template-chooser dialog
    (and any equivalent wizard in other app types) because the document is
    created programmatically without invoking the Start Centre UI.
    """
    factory_map = {
        "writer":  "private:factory/swriter",
        "calc":    "private:factory/scalc",
        "impress": "private:factory/simpress",
    }
    at = (app_type or "").lower().strip()
    factory_url = factory_map.get(at)
    if not factory_url:
        return {"error": f"Unknown app type: '{app_type}'. Use writer, calc, or impress."}

    try:
        from com.sun.star.beans import PropertyValue  # type: ignore
        p = PropertyValue()
        p.Name  = "Hidden"
        p.Value = False  # False = show the window (Hidden=True would create invisible)
        comp = desktop.loadComponentFromURL(factory_url, "_blank", 0, (p,))
        if comp is None:
            return {"error": "loadComponentFromURL returned None"}

        # Retrieve window title from the frame
        name = ""
        try:
            frame = comp.getCurrentController().Frame
            name  = frame.Title
        except Exception:
            try:
                name = comp.getURL() or ""
            except Exception:
                pass

        return {"result": "created", "name": name}
    except Exception as ex:
        return {"error": f"NEWDOC failed: {ex}"}


# ── Schema ────────────────────────────────────────────────────────────────────

SCHEMA = {
    "helper":      "lo_helper",
    "version":     "1.0.0",
    "description": (
        "LibreOffice UNO socket bridge — LO 24+ compatibility layer "
        "for LibreOfficeWin.exe.  Exposes QUERYTREE/READ/WRITE/FORMAT/"
        "SAVE/EXPORT over JSON stdin/stdout."
    ),
    "commands": [
        {
            "name":   "QUERYTREE",
            "target": "writer|calc|impress",
            "params": {"path": "optional depth (1/2/3, default 3)"},
        },
        {
            "name":   "READ",
            "target": "writer|calc|impress",
            "params": {"path": "document path (e.g. body, body/para[1], Sheet1.A1, slide[1])"},
        },
        {
            "name":   "WRITE",
            "target": "writer|calc|impress",
            "params": {"path": "document path", "value": "new content"},
        },
        {
            "name":   "FORMAT",
            "target": "writer",
            "params": {
                "path":  "body/para[N]",
                "value": "pipe-separated key=val, e.g. bold=true|fontsize=14|alignment=center",
            },
        },
        {
            "name":   "SAVE",
            "target": "writer|calc|impress",
            "params": {},
        },
        {
            "name":   "EXPORT",
            "target": "writer|calc|impress",
            "params": {"path": "'pdf' or absolute target .pdf path"},
        },
        {
            "name":   "LISTDOCS",
            "target": "(any)",
            "params": {},
        },
    ],
}

# ── Main read-eval loop ───────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="LibreOffice UNO bridge — JSON stdin/stdout")
    parser.add_argument("--port",       type=int, default=2002,
                        help="UNO socket port (default 2002)")
    parser.add_argument("--persistent", action="store_true",
                        help="Keep reading after first command (daemon mode)")
    args = parser.parse_args()

    # Connect to LO UNO socket
    try:
        desktop, _ctx = connect_uno(args.port)
    except Exception as ex:
        err("", f"UNO connection failed on port {args.port}: {ex}")
        sys.exit(1)

    # Signal ready to the spawning process (LibreOfficeWin.exe reads this line)
    ok("", "ready")

    stdin = sys.stdin
    for raw in stdin:
        raw = raw.strip()
        if not raw:
            continue

        req_id = ""
        try:
            req    = json.loads(raw)
            req_id = req.get("id",     "") or ""
            action = req.get("action", "") or ""
            target = req.get("target", "") or ""
            path   = req.get("path",   "") or ""
            value  = req.get("value",  "") or ""

            # ── Built-in actions ────────────────────────────────────────────
            if action == "_schema":
                ok(req_id, SCHEMA)
                if not args.persistent:
                    break
                continue

            if action == "_ping":
                ok(req_id, {"pong": True})
                if not args.persistent:
                    break
                continue

            if action == "_exit":
                ok(req_id, "bye")
                break

            # ── LISTDOCS (no document resolution needed) ─────────────────
            if action == "LISTDOCS":
                ok(req_id, cmd_listdocs(desktop))
                if not args.persistent:
                    break
                continue

            # ── NEWDOC — create blank document via UNO (no doc to resolve) ─
            if action == "NEWDOC":
                r = cmd_newdoc(desktop, target)
                if "error" in r:
                    err(req_id, r["error"])
                else:
                    ok(req_id, r)
                if not args.persistent:
                    break
                continue

            # ── Resolve target document ──────────────────────────────────
            doc, app_type = find_doc(desktop, target)
            if doc is None:
                err(req_id,
                    f"No open document found for target: {target}")
                if not args.persistent:
                    break
                continue

            # ── Dispatch ─────────────────────────────────────────────────
            if action == "QUERYTREE":
                depth = 3
                try:
                    if path and path.isdigit():
                        depth = int(path)
                except Exception:
                    pass
                ok(req_id, cmd_querytree(doc, app_type, depth))

            elif action == "READ":
                ok(req_id, cmd_read(doc, app_type, path))

            elif action == "WRITE":
                cmd_write(doc, app_type, path, value)
                ok(req_id, "written")

            elif action == "FORMAT":
                r = cmd_format(doc, app_type, path, value)
                _emit({"id": req_id, "success": True, **r})

            elif action == "SAVE":
                r = cmd_save(doc, app_type, "")
                _emit({"id": req_id, "success": True, **r})

            elif action == "EXPORT":
                r = cmd_save(doc, app_type, path or "pdf")
                _emit({"id": req_id, "success": True, **r})

            else:
                err(req_id, f"Unknown command: {action}")

        except Exception as ex:
            err(req_id, str(ex))

        if not args.persistent:
            break


if __name__ == "__main__":
    main()
