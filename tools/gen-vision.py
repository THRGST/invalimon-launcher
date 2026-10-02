#!/usr/bin/env python3
# Escribe inv:vision/tick.mcfunction (server) con las lineas de tiles del overlay.
# Los chars PUA se generan por codigo (chr) -> los bytes salen SIEMPRE correctos.
#   U+E120 = tile rojo | U+E121 = tile negro
import os

RED = chr(0xE120)
NEG = chr(0xE121)
TILES = 12            # tiles por fila; en modo negro: mitad rojo + mitad negro
HALF = TILES // 2

MCF = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)),
    "..", "..", "server", "datapacks", "invalimon",
    "data", "inv", "function", "vision", "tick.mcfunction"))

red_line = RED * TILES
negro_line = RED * HALF + NEG * HALF

lines = [
    "# Re-pinta el overlay de vision cada 2s (loopea hasta que inv:vision/parar corte)",
    "execute unless score #vision_on inv.vision matches 1 run return 0",
    "title @a times 0 60 0",
    'execute if score #negro inv.vision matches 1 run title @a title {"text":"' + negro_line + '","font":"invalimon:overlay"}',
    'execute if score #negro inv.vision matches 0 run title @a title {"text":"' + red_line + '","font":"invalimon:overlay"}',
    "schedule function inv:vision/tick 40t",
    "",
]
with open(MCF, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("ok:", MCF)
print("fila roja:", len(red_line), "tiles | fila negra:", len(negro_line),
      "tiles | codepoints:", hex(ord(red_line[0])), hex(ord(negro_line[HALF])))
