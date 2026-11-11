"""
Figures and marks of the Road Editor's cockpit, as one greyscale sheet: white is ink.

    python3 sheet.py ../../demo/public/textures/road-cockpit.png     (needs ImageMagick and Barlow Condensed)

It is set in the type of the MakioMeshlines hover car (scripts/hover-car/livery.py). The script
prints where each mark landed, in pixels from the top left corner: `SHEET` in
demo/src/utils/surfaceRoadCockpit.js mirrors that.
"""
import os
import subprocess
import sys
import tempfile

OUT = sys.argv[1] if len( sys.argv ) > 1 else 'road-cockpit.png'
FONTS = os.path.expanduser( '~/Library/Fonts' )
RACING = f'{FONTS}/BarlowCondensed-BlackItalic.ttf'
LABEL = f'{FONTS}/BarlowCondensed-ExtraBold.ttf'
CODE = '/System/Library/Fonts/Menlo.ttc'
TMP = tempfile.mkdtemp()

WIDTH = 2048
GAP = 24
# Every digit stands in a cell of this size, so figures keep their columns.
DIGIT = ( 128, 200 )


def magick( *args ):
	return subprocess.run( ['magick', *map( str, args )], check = True, capture_output = True, text = True ).stdout


def mark( name, *args ):
	"""Render a trimmed sprite and return ( name, path, width, height )."""
	path = f'{TMP}/{name}.png'
	magick( *args, '-trim', '+repage', path )
	return ( name, path, *map( int, magick( path, '-format', '%w %h', 'info:' ).split() ) )


def word( name, text, font, points, kerning = 0, outline = 0, fill = 'white' ):
	# Drawn on a roomy canvas then trimmed: `label:` clips the slanted last glyph.
	paint = ['-fill', 'none', '-stroke', fill, '-strokewidth', outline] if outline else ['-fill', fill]
	return mark( name, '-size', '2400x500', 'xc:none', *paint, '-font', font, '-pointsize', points, '-kerning', kerning, '-gravity', 'Center', '-annotate', '+0+0', text )


def roundel( name, number, diameter ):
	r = diameter / 2
	return mark( name, '-size', f'{diameter}x{diameter}', 'xc:none', '-fill', 'white', '-draw', f'circle {r},{r} {r},1',
		'-fill', 'none', '-stroke', 'black', '-strokewidth', 5, '-draw', f'circle {r},{r} {r},{diameter * 0.07}',
		'-stroke', 'none', '-fill', 'black', '-font', RACING, '-pointsize', int( diameter * 0.6 ), '-gravity', 'Center', '-annotate', '-4+0', number )


def wordmark( name, points, outline ):
	"""MAKIO solid, MESHLINES drawn as an outline."""
	solid = word( f'{name}-makio', 'MAKIO', RACING, points, 4 )[1]
	hollow = word( f'{name}-meshlines', 'MESHLINES', RACING, points, 4, outline )[1]
	return mark( name, solid, hollow, '-background', 'none', '-gravity', 'South', '+append' )


def solid( size ):
	"""A patch of plain ink, for stripes and slashes."""
	path = f'{TMP}/solid.png'
	magick( '-size', f'{size}x{size}', 'xc:white', path )
	return ( 'solid', path, size, size )


def digits():
	"""Ten cells in a row, every digit on the same baseline."""
	cells = []
	for digit in range( 10 ):
		path = f'{TMP}/digit-{digit}.png'
		magick( '-size', f'{DIGIT[0]}x{DIGIT[1]}', 'xc:none', '-fill', 'white', '-font', RACING, '-pointsize', 218, '-gravity', 'Center', '-annotate', '-6+0', digit, path )
		cells.append( path )
	path = f'{TMP}/digits.png'
	magick( *cells, '-background', 'none', '+append', path )
	return ( 'digits', path, DIGIT[0] * 10, DIGIT[1] )


sprites = [
	digits(),
	roundel( 'roundel', '64', 196 ),
	solid( 48 ),
	wordmark( 'name', 170, 8 ),
	word( 'unit', 'KM/H', LABEL, 78, 3 ),
	word( 'fps', 'FPS', LABEL, 78, 3 ),
	word( 'vertices', 'VERTS', LABEL, 78, 3 ),
	word( 'triangles', 'TRIS', LABEL, 78, 3 ),
	word( 'install', 'pnpm i makio-meshline', CODE, 54 ),
]

# Shelves: sprites go left to right, and start a new row when one would not fit.
placed = []
x = y = shelf = 0
for name, path, width, height in sprites:
	if x + width > WIDTH:
		x, y, shelf = 0, y + shelf + GAP, 0
	placed.append( ( name, path, x, y, width, height ) )
	x += width + GAP
	shelf = max( shelf, height )
height = y + shelf
# A height that halves cleanly, for the mip chain.
height += -height % 64

canvas = ['-size', f'{WIDTH}x{height}', 'xc:black']
for name, path, left, top, w, h in placed:
	canvas.extend( ['(', path, ')', '-geometry', f'+{left}+{top}', '-composite'] )
magick( *canvas, '-colorspace', 'Gray', '-depth', '8', '-define', 'png:color-type=0', OUT )

print( f'width: {WIDTH}, height: {height}, digit: [{DIGIT[0]}, {DIGIT[1]}]' )
for name, path, left, top, w, h in placed:
	print( f'{name}: [{left}, {top}, {w}, {h}],' )
