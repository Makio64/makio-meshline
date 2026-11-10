"""
Builds demo/public/models/hover-car.glb, the MakioMeshlines car of the Wind
Tunnel demo: a lofted, subdivided body with a glass canopy, light bars, hover
pads, a rear wing and its racing livery. The demo swaps the Paint, Glass and
Trim materials for its own finishes, by name.

    python3 livery.py livery.png
    blender -b --factory-startup -P build_car.py -- livery.png hover-car.glb [preview_dir]

Blender axes: the nose points to -Y and Z is up, so the exported glTF has its
nose on +Z, which is upstream in the wind tunnel, and stands at its hover height.
"""
import math
import sys

import bmesh
import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index( '--' ) + 1:]
LIVERY, OUT_GLB = ARGS[0], ARGS[1]
PREVIEW_DIR = ARGS[2] if len( ARGS ) > 2 else None

LENGTH = 4.7
NOSE_Y = -2.25
LIFT = 0.04

# Material slots of the final mesh.
PAINT, GLASS, TRIM, HEADLIGHT, TAILLIGHT, GLOW = range( 6 )

# Regions of the 2048 px livery image, as livery.py lays them out: pixels per
# metre and origins of the two flanks, of the plan view and of the wing top.
FLANK, S_A, S_B, Z_A, Z_B = 518.5, 0.8, 4.75, 0.36, 1.34
PLAN, X_A = 2048 / 4.75, -1.1
WING_X, WING_Y, WING_S, WING_HALF = 400, 2, 4.28, 0.9
# Texels of plain paint and of plain carbon black.
PLAIN, PLAIN_BLACK = ( 60, 1990 ), ( 340, 96 )


def spline( keys ):
	"""Catmull-Rom through ( s, value ) keys."""
	xs = [k[0] for k in keys]
	ys = [k[1] for k in keys]
	n = len( keys )
	tangents = []
	for i in range( n ):
		a, b = max( i - 1, 0 ), min( i + 1, n - 1 )
		tangents.append( ( ys[b] - ys[a] ) / ( xs[b] - xs[a] ) )

	def at( s ):
		s = min( max( s, xs[0] ), xs[-1] )
		i = max( j for j in range( n - 1 ) if xs[j] <= s )
		h = xs[i + 1] - xs[i]
		t = ( s - xs[i] ) / h
		return ( ( 2 * t ** 3 - 3 * t ** 2 + 1 ) * ys[i] + ( t ** 3 - 2 * t ** 2 + t ) * h * tangents[i]
			+ ( -2 * t ** 3 + 3 * t ** 2 ) * ys[i + 1] + ( t ** 3 - t ** 2 ) * h * tangents[i + 1] )
	return at


# The car, as curves along its length ( s = distance from the nose ).
# In plan it is waisted at the doors and widest over the hover pads.
half_width = spline( [( 0, 0.60 ), ( 0.07, 0.74 ), ( 0.2, 0.86 ), ( 0.5, 0.97 ), ( 1.0, 1.03 ), ( 1.6, 1.02 ), ( 2.4, 0.97 ), ( 3.1, 1.00 ), ( 3.7, 1.04 ), ( 4.3, 1.02 ), ( 4.7, 0.97 )] )
floor = spline( [( 0, 0.42 ), ( 0.2, 0.35 ), ( 0.5, 0.31 ), ( 0.9, 0.30 ), ( 3.9, 0.30 ), ( 4.3, 0.35 ), ( 4.7, 0.46 )] )
# Crest of the flanks: two fenders over the pads with a dip at the door between them.
fender = spline( [( 0, 0.465 ), ( 0.2, 0.56 ), ( 0.6, 0.70 ), ( 1.0, 0.80 ), ( 1.5, 0.80 ), ( 2.0, 0.76 ), ( 2.5, 0.75 ), ( 3.0, 0.80 ), ( 3.6, 0.90 ), ( 4.2, 0.92 ), ( 4.7, 0.86 )] )
# The deck the canopy stands on: a valley between the front fenders, the hood.
deck = spline( [( 0, 0.47 ), ( 0.2, 0.555 ), ( 0.6, 0.66 ), ( 1.0, 0.72 ), ( 1.4, 0.76 ), ( 2.0, 0.78 ), ( 2.6, 0.80 ), ( 3.2, 0.84 ), ( 3.8, 0.88 ), ( 4.3, 0.90 ), ( 4.7, 0.855 )] )
crown = spline( [( 0, 0.50 ), ( 0.2, 0.59 ), ( 0.6, 0.69 ), ( 1.0, 0.75 ), ( 1.35, 0.80 ), ( 1.7, 1.00 ), ( 2.1, 1.19 ), ( 2.5, 1.25 ), ( 2.9, 1.22 ), ( 3.4, 1.10 ), ( 3.9, 0.98 ), ( 4.3, 0.93 ), ( 4.7, 0.885 )] )
# Half width of the canopy foot: a teardrop that narrows into a spine down the tail.
canopy = spline( [( 0, 0.40 ), ( 0.6, 0.52 ), ( 1.3, 0.60 ), ( 1.8, 0.62 ), ( 2.5, 0.60 ), ( 3.2, 0.50 ), ( 3.9, 0.36 ), ( 4.4, 0.30 ), ( 4.7, 0.28 )] )

STATIONS = [0, 0.07, 0.2, 0.45, 0.8, 1.1, 1.3, 1.52, 1.75, 2.0, 2.25, 2.5, 2.75, 3.0, 3.25, 3.5, 3.72, 3.9, 4.15, 4.4, 4.58, 4.7]
COWL, DECK = 1.3, 3.5  # the canopy glass runs between these two stations
ROWS = 13  # quads around half a section


def section( s ):
	"""Half a cross-section at `s`, from the keel round to the crown: 14 ( x, z ) points."""
	w, zb, zf, zd, zt = half_width( s ), floor( s ), fender( s ), deck( s ), crown( s )
	foot = canopy( s )
	points = [
		( 0, zb ),
		( 0.50 * w, zb ),
		( 0.82 * w, zb + 0.004 ),
		( 0.94 * w, zb + 0.12 * ( zf - zb ) ),
		( w, zb + 0.55 * ( zf - zb ) ),
		( 0.985 * w, zf - 0.1 * ( zf - zb ) ),
		( 0.90 * w, zf + 0.012 ),
		( 0.5 * ( 0.9 * w + foot ) + 0.04, 0.35 * zf + 0.65 * zd ),
	]
	# The top is a squircle from the canopy foot to the crown: a gentle hood,
	# or upright glass turning into a roof where the crown stands high.
	for step in range( 6 ):
		angle = step / 5 * math.pi / 2
		points.append( ( foot * math.cos( angle ) ** 0.68, zd + ( zt - zd ) * math.sin( angle ) ** 0.68 ) )
	return points


def subdivided( bm, name, levels = 2 ):
	"""Mesh of `bm` after Catmull-Clark subdivision."""
	mesh = bpy.data.meshes.new( name )
	bm.to_mesh( mesh )
	bm.free()
	obj = bpy.data.objects.new( name, mesh )
	bpy.context.scene.collection.objects.link( obj )
	modifier = obj.modifiers.new( 'Subdivision', 'SUBSURF' )
	modifier.levels = modifier.render_levels = levels
	result = bpy.data.meshes.new_from_object( obj.evaluated_get( bpy.context.evaluated_depsgraph_get() ) )
	bpy.data.objects.remove( obj )
	return result


def build_body():
	bm = bmesh.new()
	crease = bm.edges.layers.float.new( 'crease_edge' )
	rings = []
	for s in STATIONS:
		rings.append( [bm.verts.new( ( x, NOSE_Y + s, z + LIFT ) ) for x, z in section( s )] )

	def edge_crease( a, b, value ):
		edge = bm.edges.get( ( a, b ) )
		if edge: edge[crease] = max( edge[crease], value )

	for i in range( len( STATIONS ) - 1 ):
		mid = ( STATIONS[i] + STATIONS[i + 1] ) / 2
		for j in range( ROWS ):
			face = bm.faces.new( ( rings[i][j], rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1] ) )
			if j < 3:
				face.material_index = TRIM
			elif j >= 8 and COWL < mid < DECK:
				face.material_index = GLASS
			# A lamp let into the front of each fender.
			elif j == 5 and 0.2 < mid < 0.45:
				face.material_index = HEADLIGHT
			else:
				face.material_index = PAINT

	# Ends: a ladder of quads from the section to the centreline. The nose is a
	# thin blade lit across its width; the tail is cut square, with a light bar
	# under its upper edge.
	for ring, lit, light in ( ( rings[0], range( 3, 8 ), HEADLIGHT ), ( rings[-1], range( 5, 7 ), TAILLIGHT ) ):
		centre = [ring[0]] + [bm.verts.new( ( 0, v.co.y, v.co.z ) ) for v in ring[1:-1]] + [ring[-1]]
		for j in range( ROWS ):
			corners = [ring[j], ring[j + 1], centre[j + 1], centre[j]]
			face = bm.faces.new( [v for k, v in enumerate( corners ) if v not in corners[:k]] )
			face.material_index = light if j in lit else ( TRIM if j < 7 else PAINT )
		for j in range( ROWS ):
			edge_crease( ring[j], ring[j + 1], 0.75 )

	for i in range( len( STATIONS ) - 1 ):
		edge_crease( rings[i][3], rings[i + 1][3], 0.55 )  # sill
		edge_crease( rings[i][6], rings[i + 1][6], 0.35 )  # fender crest
		edge_crease( rings[i][2], rings[i + 1][2], 0.4 )  # floor edge

	bmesh.ops.mirror( bm, geom = bm.verts[:] + bm.edges[:] + bm.faces[:], axis = 'X', merge_dist = 1e-5 )
	bmesh.ops.recalc_face_normals( bm, faces = bm.faces[:] )
	return subdivided( bm, 'Body' )


def box( bm, centre, size, material, crease = None ):
	layer = bm.edges.layers.float.get( 'crease_edge' ) or bm.edges.layers.float.new( 'crease_edge' )
	made = bmesh.ops.create_cube( bm, size = 1 )
	for vert in made['verts']:
		vert.co = Vector( ( vert.co.x * size[0], vert.co.y * size[1], vert.co.z * size[2] ) ) + Vector( centre )
	faces = set( f for v in made['verts'] for f in v.link_faces )
	for face in faces:
		face.material_index = material
		if crease is not None:
			for edge in face.edges: edge[layer] = crease


def build_parts():
	"""Hover pads with glowing soles, the splitter under the nose and the rear wing."""
	soft = bmesh.new()
	crisp = bmesh.new()
	soles = bmesh.new()
	for side in ( -1, 1 ):
		for s in ( 1.25, 3.6 ):
			y = NOSE_Y + s
			box( soft, ( side * 0.72, y, 0.24 + LIFT ), ( 0.3, 1.12, 0.2 ), TRIM, 0.45 )
			box( soles, ( side * 0.72, y, 0.128 + LIFT ), ( 0.17, 0.92, 0.016 ), GLOW )
		# Wing endplate, standing on the rear fender.
		box( crisp, ( side * 0.9, NOSE_Y + 4.42, 1.06 + LIFT ), ( 0.028, 0.56, 0.4 ), PAINT, 0.85 )
	box( crisp, ( 0, NOSE_Y + 0.14, 0.412 + LIFT ), ( 1.5, 0.4, 0.018 ), TRIM, 0.85 )

	# The wing, pitched nose-down about its own span.
	box( crisp, ( 0, 0, 0 ), ( 1.8, 0.36, 0.03 ), PAINT, 0.85 )
	crisp.verts.ensure_lookup_table()
	pitch = math.radians( -9 )
	for vert in crisp.verts[-8:]:
		y, z = vert.co.y, vert.co.z
		vert.co.y = NOSE_Y + 4.46 + y * math.cos( pitch ) - z * math.sin( pitch )
		vert.co.z = 1.2 + LIFT + y * math.sin( pitch ) + z * math.cos( pitch )

	for bm in ( soft, crisp, soles ):
		bmesh.ops.recalc_face_normals( bm, faces = bm.faces[:] )
	sole_mesh = bpy.data.meshes.new( 'Soles' )
	soles.to_mesh( sole_mesh )
	soles.free()
	return [subdivided( soft, 'Pads' ), subdivided( crisp, 'Wing' ), sole_mesh]


def paint_livery( mesh ):
	"""Project the livery: flanks from the side, hood and deck from above, the wing on its own strip."""
	uv = mesh.uv_layers[0].data
	for polygon in mesh.polygons:
		if polygon.material_index != PAINT: continue
		normal = polygon.normal
		corners = [mesh.vertices[v].co for v in polygon.vertices]
		# The wing and its endplates, in carbon black: above the deck, or standing on the fenders.
		centre = polygon.center
		aft = centre.y - NOSE_Y > 4.05 and ( centre.z > 1.1 or ( 0.87 < abs( centre.x ) < 0.93 and centre.z > 0.975 ) )
		on_flank = abs( normal.x ) > 0.6 and all( S_A < co.y - NOSE_Y < S_B and Z_A < co.z < Z_B for co in corners )

		for loop, co in zip( polygon.loop_indices, corners ):
			s = co.y - NOSE_Y
			if aft and normal.z > 0.5 and centre.z > 1.15:
				pixel = ( WING_X + ( WING_HALF - co.x ) * FLANK, WING_Y + ( s - WING_S ) * FLANK )
			elif not aft and normal.z > 0.2 and normal.z >= abs( normal.x ):
				pixel = ( s * PLAN, 1024 + ( co.x - X_A ) * PLAN )
			elif on_flank:
				# +X flank: first rows, nose to the left. -X flank: next rows, nose to the right.
				x, y = ( s - S_A ) * FLANK, ( Z_B - co.z ) * FLANK
				pixel = ( x, y ) if normal.x > 0 else ( 2048 - x, 512 + y )
			else:
				pixel = PLAIN_BLACK if aft else PLAIN
			uv[loop].uv = ( pixel[0] / 2048, 1 - pixel[1] / 2048 )


def material( name, color, roughness, emission = None, strength = 1, image = None ):
	mat = bpy.data.materials.new( name )
	mat.use_nodes = True
	shader = mat.node_tree.nodes['Principled BSDF']
	shader.inputs['Base Color'].default_value = ( *color, 1 )
	shader.inputs['Roughness'].default_value = roughness
	if emission:
		shader.inputs['Emission Color'].default_value = ( *emission, 1 )
		shader.inputs['Emission Strength'].default_value = strength
	if image:
		texture = mat.node_tree.nodes.new( 'ShaderNodeTexImage' )
		texture.image = image
		mat.node_tree.links.new( texture.outputs['Color'], shader.inputs['Base Color'] )
	return mat


def build():
	bpy.ops.wm.read_factory_settings( use_empty = True )
	livery = bpy.data.images.load( LIVERY )
	livery.pack()

	car = bmesh.new()
	for part in [build_body()] + build_parts():
		car.from_mesh( part )

	mesh = bpy.data.meshes.new( 'HoverCar' )
	car.to_mesh( mesh )
	car.free()
	mesh.uv_layers.new( name = 'UVMap' )
	paint_livery( mesh )
	for polygon in mesh.polygons: polygon.use_smooth = True

	for mat in (
		material( 'Paint', ( 1, 1, 1 ), 0.42, image = livery ),
		material( 'Glass', ( 0.012, 0.016, 0.022 ), 0.06 ),
		material( 'Trim', ( 0.022, 0.024, 0.028 ), 0.55 ),
		material( 'Headlight', ( 0.02, 0.02, 0.02 ), 0.3, emission = ( 0.85, 0.95, 1 ) ),
		material( 'Taillight', ( 0.02, 0.0, 0.0 ), 0.3, emission = ( 1, 0.06, 0.04 ), strength = 2.5 ),
		material( 'Glow', ( 0.0, 0.02, 0.03 ), 0.3, emission = ( 0.25, 0.85, 1 ), strength = 1.3 ),
	):
		mesh.materials.append( mat )

	car_object = bpy.data.objects.new( 'HoverCar', mesh )
	bpy.context.scene.collection.objects.link( car_object )
	return car_object


def preview( car_object ):
	scene = bpy.context.scene
	scene.render.engine = 'BLENDER_EEVEE' if 'BLENDER_EEVEE' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE_NEXT'
	scene.render.resolution_x, scene.render.resolution_y = 1280, 720
	scene.view_settings.view_transform = 'Filmic' if 'Filmic' in [i.identifier for i in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items] else 'AgX'
	world = bpy.data.worlds.new( 'Studio' )
	world.use_nodes = True
	world.node_tree.nodes['Background'].inputs['Color'].default_value = ( 0.03, 0.035, 0.045, 1 )
	world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1
	scene.world = world

	def area( location, size, energy, color = ( 1, 1, 1 ) ):
		data = bpy.data.lights.new( 'Softbox', 'AREA' )
		data.shape = 'RECTANGLE'
		data.size, data.size_y = size
		data.energy = energy
		data.color = color
		light = bpy.data.objects.new( 'Softbox', data )
		light.location = location
		light.rotation_euler = ( Vector( ( 0, 0, 0 ) ) - Vector( location ) ).to_track_quat( '-Z', 'Y' ).to_euler()
		scene.collection.objects.link( light )

	area( ( 0, 0, 6 ), ( 5, 12 ), 2600 )
	area( ( 6, -5, 2.5 ), ( 3, 6 ), 1500 )
	area( ( -7, 4, 2 ), ( 3, 6 ), 1200, ( 0.6, 0.85, 1 ) )

	floor_mesh = bpy.data.meshes.new( 'Floor' )
	floor_bm = bmesh.new()
	bmesh.ops.create_grid( floor_bm, x_segments = 1, y_segments = 1, size = 30 )
	floor_bm.to_mesh( floor_mesh )
	floor_mesh.materials.append( material( 'Floor', ( 0.02, 0.022, 0.026 ), 0.35 ) )
	scene.collection.objects.link( bpy.data.objects.new( 'Floor', floor_mesh ) )

	camera = bpy.data.objects.new( 'Camera', bpy.data.cameras.new( 'Camera' ) )
	camera.data.lens = 60
	scene.collection.objects.link( camera )
	scene.camera = camera
	target = Vector( ( 0, 0.1, 0.7 ) )
	for name, position in ( ( 'front34', ( 5.2, -6.6, 2.1 ) ), ( 'side', ( 9.5, 0.1, 1.0 ) ), ( 'rear34', ( -5.2, 6.8, 2.4 ) ), ( 'top', ( 0.01, 0.1, 11 ) ), ( 'front', ( 0.0, -9.5, 1.0 ) ) ):
		camera.location = position
		camera.rotation_euler = ( target - Vector( position ) ).to_track_quat( '-Z', 'Y' ).to_euler()
		scene.render.filepath = f'{PREVIEW_DIR}/{name}.png'
		bpy.ops.render.render( write_still = True )


car_object = build()
stats = { 'verts': len( car_object.data.vertices ), 'tris': sum( len( p.vertices ) - 2 for p in car_object.data.polygons ) }
box_min = [min( v.co[i] for v in car_object.data.vertices ) for i in range( 3 )]
box_max = [max( v.co[i] for v in car_object.data.vertices ) for i in range( 3 )]
print( 'CAR', stats, [round( v, 3 ) for v in box_min], [round( v, 3 ) for v in box_max] )

bpy.ops.export_scene.gltf(
	filepath = OUT_GLB, export_format = 'GLB', export_yup = True, export_apply = True,
	export_image_format = 'WEBP', export_cameras = False, export_lights = False, export_extras = False,
	export_copyright = 'Copyright 2026 Makio64 (MIT)',
)
if PREVIEW_DIR: preview( car_object )
