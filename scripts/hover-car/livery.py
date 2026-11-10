"""
Livery of the MakioMeshlines hover car, as one 2048 x 2048 image.

    python3 livery.py livery.png     (needs ImageMagick and Barlow Condensed)

Four regions, which build_car.py projects on the paint:
- rows 0..511: the +X flank seen from outside, nose to the left;
- rows 512..1023: the -X flank, nose to the right;
- rows 1024..2047: the car seen from above, nose to the left, +X down;
- a black strip at the top of the first region: the top of the rear wing.
"""
import os
import subprocess
import sys
import tempfile

OUT = sys.argv[1] if len( sys.argv ) > 1 else 'livery.png'
FONTS = os.path.expanduser( '~/Library/Fonts' )
RACING = f'{FONTS}/BarlowCondensed-BlackItalic.ttf'
LABEL = f'{FONTS}/BarlowCondensed-ExtraBold.ttf'
CODE = '/System/Library/Fonts/Menlo.ttc'
TMP = tempfile.mkdtemp()

RED, BLACK, WHITE, CYAN, INK = '#b80f1a', '#0b0c0f', '#e9edf1', '#58dcff', '#14161a'

# Pixels per metre and origins of the regions; build_car.py mirrors these.
FLANK, S_A, Z_B = 518.5, 0.8, 1.34
PLAN, X_A = 2048 / 4.75, -1.1
WING_X, WING_Y, WING_S, WING_HALF = 400, 2, 4.28, 0.9


def flank( s, z, side ):
	"""Pixel of a flank point `s` metres behind the nose and `z` metres up."""
	x, y = ( s - S_A ) * FLANK, ( Z_B - z ) * FLANK
	return ( x, y ) if side > 0 else ( 2048 - x, 512 + y )


def plan( s, x ):
	return ( s * PLAN, 1024 + ( x - X_A ) * PLAN )


def magick( *args ):
	return subprocess.run( ['magick', *map( str, args )], check = True, capture_output = True, text = True ).stdout


sprites = {}


def mark( name, *args ):
	"""Render a trimmed sprite once and return ( path, width, height )."""
	if name not in sprites:
		path = f'{TMP}/{name}.png'
		magick( *args, '-trim', '+repage', path )
		sprites[name] = ( path, *map( int, magick( path, '-format', '%w %h', 'info:' ).split() ) )
	return sprites[name]


def word( name, text, font, points, fill = WHITE, kerning = 0, outline = 0 ):
	# Drawn on a roomy canvas then trimmed: `label:` clips the slanted last glyph.
	paint = ['-fill', 'none', '-stroke', fill, '-strokewidth', outline] if outline else ['-fill', fill]
	return mark( name, '-size', '2400x500', 'xc:none', *paint, '-font', font, '-pointsize', points, '-kerning', kerning, '-gravity', 'Center', '-annotate', '+0+0', text )


def badge( name, text, font, points, style ):
	"""A sponsor decal: 'box' is a white plate with dark type, 'outline' a white frame."""
	path, width, height = word( f'{name}-text', text, font, points, INK if style == 'box' else WHITE, 1 )
	w, h = width + 26, height + 18
	frame = ['-fill', WHITE, '-draw', f'roundrectangle 0,0 {w - 1},{h - 1} 7,7'] if style == 'box' else ['-fill', 'none', '-stroke', WHITE, '-strokewidth', 3, '-draw', f'roundrectangle 2,2 {w - 3},{h - 3} 7,7']
	return mark( name, '-size', f'{w}x{h}', 'xc:none', *frame, '-stroke', 'none', path, '-gravity', 'Center', '-composite' )


def roundel( name, number, diameter ):
	r = diameter / 2
	return mark( name, '-size', f'{diameter}x{diameter}', 'xc:none', '-fill', WHITE, '-draw', f'circle {r},{r} {r},1',
		'-fill', 'none', '-stroke', INK, '-strokewidth', 3, '-draw', f'circle {r},{r} {r},{diameter * 0.07}',
		'-stroke', 'none', '-fill', INK, '-font', RACING, '-pointsize', int( diameter * 0.6 ), '-gravity', 'Center', '-annotate', '-3+0', number )


def wordmark( name, points, outline ):
	"""MAKIO solid, MESHLINES drawn as an outline."""
	solid = word( f'{name}-makio', 'MAKIO', RACING, points, WHITE, 4 )[0]
	hollow = word( f'{name}-meshlines', 'MESHLINES', RACING, points, WHITE, 4, outline )[0]
	return mark( name, solid, hollow, '-background', 'none', '-gravity', 'South', '+append' )


canvas = ['-size', '2048x2048', f'xc:{RED}']
placed = []


def draw( fill, shape, *stroke ):
	canvas.extend( ['-fill', fill, '-stroke', 'none', *stroke, '-draw', shape] )


def polygon( points ):
	return 'polygon ' + ' '.join( f'{x:.1f},{y:.1f}' for x, y in points )


def place( sprite, centre, rotate = 0, fit = None ):
	"""Composite a sprite centred on a pixel, optionally scaled to `fit` pixels wide and turned."""
	path, width, height = sprite
	name = os.path.basename( path )[:-4]
	if fit:
		path, width, height = mark( f'{name}-w{round( fit )}', path, '-resize', f'{round( fit )}x' )
	if rotate:
		path, width, height = mark( f'{name}-w{round( fit or 0 )}-r{rotate}', path, '-background', 'none', '-rotate', rotate )
	placed.extend( ['(', path, ')', '-geometry', f'+{round( centre[0] - width / 2 )}+{round( centre[1] - height / 2 )}', '-composite'] )


# Carbon black for the wing and its endplates.
draw( BLACK, 'rectangle 300,0 1342,194' )
draw( BLACK, 'rectangle 1722,10 2040,200' )
draw( BLACK, 'rectangle 8,522 326,712' )

NAME = wordmark( 'name', 160, 7 )

for side in ( 1, -1 ):
	# Mesh lines: pinstripes that leave the nose together and fan out to the tail.
	for i in range( 8 ):
		a, b, c, d = ( flank( s, z, side ) for s, z in ( ( 0.8, 0.5 + i * 0.01 ), ( 2.2, 0.47 + i * 0.012 ), ( 3.3, 0.56 + i * 0.05 ), ( 4.75, 0.5 + i * 0.062 ) ) )
		draw( 'none', f'bezier {a[0]:.1f},{a[1]:.1f} {b[0]:.1f},{b[1]:.1f} {c[0]:.1f},{c[1]:.1f} {d[0]:.1f},{d[1]:.1f}', '-stroke', 'rgba(255,255,255,0.16)', '-strokewidth', 3 )
	# Two pinstripes along the sill.
	draw( WHITE, polygon( [flank( 0.9, 0.468, side ), flank( 4.72, 0.468, side ), flank( 4.72, 0.455, side ), flank( 0.9, 0.455, side )] ) )
	draw( CYAN, polygon( [flank( 0.9, 0.444, side ), flank( 4.72, 0.444, side ), flank( 4.72, 0.436, side ), flank( 0.9, 0.436, side )] ) )
	# Behind the name, three slashes swept back by the wind: on either flank their
	# tops lean to the tail.
	for start, width, tint in ( ( 3.02, 0.07, WHITE ), ( 3.115, 0.03, CYAN ), ( 3.165, 0.016, WHITE ) ):
		draw( tint, polygon( [flank( start, 0.5, side ), flank( start + width, 0.5, side ), flank( start + width + 0.12, 0.78, side ), flank( start + 0.12, 0.78, side )] ) )

	place( NAME, flank( 2.27, 0.612, side ), fit = 1.36 * FLANK )
	place( roundel( 'number', '64', 144 ), flank( 3.72, 0.665, side ) )

	# Sponsors on the front fender, clear of the curve of the nose.
	for row, ( left, right ) in enumerate( ( ( ( 'three.js', CODE, 30, 'plain' ), ( 'WebGPU', LABEL, 40, 'box' ) ), ( ( 'pnpm', LABEL, 42, 'box' ), ( 'TSL', LABEL, 40, 'outline' ) ), ( ( 'vite', LABEL, 40, 'outline' ), ( 'vue', LABEL, 44, 'plain' ) ) ) ):
		for column, ( text, font, points, style ) in enumerate( ( left, right ) ):
			sprite = word( f'sponsor-{text}', text, font, points, WHITE, 1 ) if style == 'plain' else badge( f'sponsor-{text}', text, font, points, style )
			place( sprite, flank( 1.1 + column * 0.29, 0.7 - row * 0.085, side ) )

	# House rules on the rear quarter.
	place( badge( 'release', 'r187', CODE, 28, 'outline' ), flank( 4.26, 0.735, side ) )
	place( word( 'rule-semicolons', 'NO SEMICOLONS', LABEL, 26, WHITE, 2 ), flank( 4.26, 0.655, side ) )
	place( word( 'rule-tabs', 'TABS > SPACES', LABEL, 26, CYAN, 2 ), flank( 4.26, 0.605, side ) )
	place( word( 'endplate', 'three.js', CODE, 46 ), flank( 4.42, 1.105, side ), fit = 0.36 * FLANK )

# From above, everything sits on the centreline: the name across the nose and the
# install line under it (both read from the front), the number on the hood, and
# a triple stripe that leaves the number and runs to the tail. Mesh lines fan
# back over the hood, and two sponsors ride the rear fenders.
for i in range( -7, 8 ):
	a, b, c = plan( 0.05, i * 0.012 ), plan( 0.7, i * 0.03 ), plan( 1.45, i * 0.085 )
	draw( 'none', f'bezier {a[0]:.1f},{a[1]:.1f} {b[0]:.1f},{b[1]:.1f} {b[0]:.1f},{b[1]:.1f} {c[0]:.1f},{c[1]:.1f}', '-stroke', 'rgba(255,255,255,0.14)', '-strokewidth', 3 )
draw( WHITE, polygon( [plan( 0.86, -0.085 ), plan( 4.75, -0.085 ), plan( 4.75, 0.085 ), plan( 0.86, 0.085 )] ) )
for edge in ( -1, 1 ):
	draw( CYAN, polygon( [plan( 0.86, edge * 0.11 ), plan( 4.75, edge * 0.11 ), plan( 4.75, edge * 0.135 ), plan( 0.86, edge * 0.135 )] ) )
# A ring of paint keeps the number off the stripe.
centre = plan( 0.86, 0 )
draw( RED, f'circle {centre[0]:.1f},{centre[1]:.1f} {centre[0] + 0.245 * PLAN:.1f},{centre[1]:.1f}' )
place( roundel( 'hood', '64', 190 ), centre, 90 )
place( wordmark( 'nose', 160, 11 ), plan( 0.28, 0 ), 90, fit = 1.02 * PLAN )
place( word( 'install', 'pnpm i makio-meshline', CODE, 40 ), plan( 0.5, 0 ), 90, fit = 0.6 * PLAN )
place( badge( 'deck-three', 'three.js', CODE, 26, 'outline' ), plan( 3.9, -0.74 ) )
place( badge( 'deck-webgpu', 'WebGPU', LABEL, 36, 'box' ), plan( 3.9, 0.74 ) )

# The wing reads from behind the car.
place( NAME, ( WING_X + WING_HALF * FLANK, WING_Y + 0.18 * FLANK ), fit = 1.42 * FLANK )

magick( *canvas, '-gravity', 'NorthWest', *placed, '-depth', '8', OUT )
