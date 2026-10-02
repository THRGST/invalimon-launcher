#!/usr/bin/env python3
# Reemplaza/agrega archivos dentro del resource pack (el .zip ES la fuente).
# Uso: python3 pack-add.py <ruta-en-zip> <archivo-local> [<ruta-en-zip> <archivo-local> ...]
# Ej:  python3 pack-add.py assets/invalimon/font/overlay.json tools/overlay.json
import os
import shutil
import sys
import zipfile

ZIP = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", "resourcepacks", "Invalimon-Paisaje.zip"))

pairs = dict(zip(sys.argv[1::2], sys.argv[2::2]))
if not pairs:
    sys.exit("uso: pack-add.py <ruta-en-zip> <local> [...]")

if not os.path.exists(ZIP + ".bak"):
    shutil.copy2(ZIP, ZIP + ".bak")
    print("backup:", ZIP + ".bak")

tmp = ZIP + ".tmp"
with zipfile.ZipFile(ZIP) as zin, zipfile.ZipFile(tmp, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        if item.filename in pairs:
            continue
        zout.writestr(item, zin.read(item.filename))
    for zpath, local in pairs.items():
        zout.write(local, zpath)
        print("agregado:", zpath, "<-", local)
shutil.move(tmp, ZIP)
print("zip actualizado:", ZIP)
