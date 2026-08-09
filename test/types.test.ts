import { Box3, DynamicDrawUsage, PerspectiveCamera, Scene, Vector2, type WebGPURenderer } from 'three/webgpu'

import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import MeshLineGPUPath from 'makio-meshline/gpu-path'

import {
	MeshLine,
	MeshLineGeometry,
	MeshLineNodeMaterial,
	MeshLineSurfaceGeometry,
	MeshLineSurfaceNodeMaterial,
} from '../src/index.js'

const points = new Float32Array( [0, 0, 0, 1, 0, 0, 2, 0, 1] )
declare const renderer: WebGPURenderer

const road = new MeshLine( {
	lines: points,
	surface: true,
	join: { type: 'simple', limit: 2 },
	cap: { type: 'round', segments: 12 },
} )
	.widthCallback( ( progress, pointIndex, lineIndex ) => progress + ( pointIndex ?? 0 ) + ( lineIndex ?? 0 ) )
	.cap( 'square' )
	.surface( { frame: 'transport', uvMode: 'distance', uvScale: 2 } )
	.surface( false )

const geometry = new MeshLineGeometry( { lines: points } )
geometry.setUsage( DynamicDrawUsage )
geometry.setPositionRange( new Float32Array( [1, 0.25, 0] ), 1, { updateBounding: true } )
road.setPositionRange( new Float32Array( [1, 0.25, 0] ), 1 )

const surfaceGeometry = new MeshLineSurfaceGeometry( {
	lines: points,
	join: { type: 'simple' },
	cap: 'round',
	needsTangents: true,
} )
surfaceGeometry.setUsage( DynamicDrawUsage, 'position' )

const material = new MeshLineNodeMaterial( {
	lineWidth: 2,
	resolution: new Vector2( 1280, 720 ),
	dashCount: 4,
} )
material.lineWidth.value = 3
material.resolution.value.set( 1920, 1080 )
if ( material.dashOffset ) material.dashOffset.value = 0.5

const surfaceMaterial = new MeshLineSurfaceNodeMaterial( {
	surface: { roughness: 0.9, metalness: 0 },
} )

const culling = MeshLineCullingSystem.attach( renderer, new Scene(), { mode: 'auto', minIndices: 4096 } )
const cullingHandle = culling.add( road, { bounds: [new Box3()], worldPadding: 1 } )
void culling.update( new PerspectiveCamera() )
cullingHandle?.remove()
culling.dispose()

const gpuPath = new MeshLineGPUPath( { lines: points, lineWidth: 0.5 }, {
	chunkSegments: 128,
	simplify: { localTolerance: 0.05 },
} )
void gpuPath.prepare( renderer, new PerspectiveCamera() )
void gpuPath.setSimplificationTolerance( 0.1 )
gpuPath.resize( 1280, 720 )

void [road, geometry, surfaceGeometry, material, surfaceMaterial, culling, gpuPath]
