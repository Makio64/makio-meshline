import { Box3, DynamicDrawUsage, PerspectiveCamera, Scene, StorageBufferAttribute, Vector2, type WebGPURenderer } from 'three/webgpu'
import { uniform } from 'three/tsl'

import MeshLineCullingSystem from 'makio-meshline/gpu-culling'
import MeshLineGPUPath from 'makio-meshline/gpu-path'

import {
	MeshLine,
	MeshLineCompute,
	MeshLineGeometry,
	MeshLineNodeMaterial,
	MeshLineSurfaceGeometry,
	MeshLineSurfaceNodeMaterial,
	storagePositions,
} from '../src/index.js'

const points = new Float32Array( [0, 0, 0, 1, 0, 0, 2, 0, 1] )
declare const renderer: WebGPURenderer

const road = new MeshLine( {
	points,
	surface: true,
	join: 'round',
	cap: { type: 'round', segments: 12 },
} )
	.points( points, false )
	.join( { type: 'simple', limit: 2 } )
	.dash( { count: 8, ratio: 0.5 } )
	.dash( false )
	.widthCallback( ( progress, pointIndex, lineIndex ) => progress + ( pointIndex ?? 0 ) + ( lineIndex ?? 0 ) )
	.cap( 'square' )
	.surface( { frame: 'transport', uvMode: 'distance', uvScale: 2 } )
	.surface( false )

const geometry = new MeshLineGeometry( { lines: points } )
geometry.setUsage( DynamicDrawUsage )
geometry.setPositionRange( new Float32Array( [1, 0.25, 0] ), 1, { updateBounding: true } )
road.setPositionRange( new Float32Array( [1, 0.25, 0] ), 1 )
const coloredLine = new MeshLine( { lines: points, vertexColors: null } ).build()
	.vertexColors( new Float32Array( [1, 0, 0, 0, 1, 0, 0, 0, 1] ) )
	.vertexColors( null )
const packedLine = new MeshLine( { lines: points, instanceCount: 2 } ).build()
packedLine.addVertexAttributes( { heat: 1, flow: 2 } )
packedLine.addInstanceAttributes( { instanceOffset: 3, instanceScale: 1 } )
const vertexBufferUsage = packedLine.getVertexBufferUsage()
packedLine.validateVertexBufferBudget( { limit: 8, reservedBuffers: 1 } )
void vertexBufferUsage.buffers.map( buffer => buffer.attributes.join( ',' ) )

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
material.setJoin( { type: 'round', fold: 'exact', limit: 3 } )

const surfaceMaterial = new MeshLineSurfaceNodeMaterial( {
	surface: { roughness: 0.9, metalness: 0 },
} )

const culling = MeshLineCullingSystem.attach( renderer, new Scene(), { mode: 'auto', minIndices: 4096 } )
const cullingHandle = culling.add( road, { bounds: [new Box3()], worldPadding: 1 } )
void culling.update( new PerspectiveCamera() )
void cullingHandle?.readCullingSnapshot().then( snapshot => snapshot?.culledChunks.map(
	chunk => chunk.chunkIndex + chunk.indexStart + chunk.indexCount
) )
cullingHandle?.remove()
culling.dispose()

const gpuPath = new MeshLineGPUPath( { lines: points, lineWidth: 0.5 }, {
	chunkSegments: 128,
	simplify: { localTolerance: 0.05 },
} )
void gpuPath.prepare( renderer, new PerspectiveCamera() )
void gpuPath.setSimplificationTolerance( 0.1 )
gpuPath.resize( 1280, 720 )

const trailBuffer = new StorageBufferAttribute( 8 * 64, 3 )
const trails = new MeshLine()
	.instances( 8 )
	.segments( 63 )
	.gpuPositionNode( storagePositions( trailBuffer, { pointsPerLine: 64, head: uniform( 0, 'uint' ) } ) )
	.build()

const curves = new MeshLineCompute( { curveCount: 32, stiffness: 0.8 } ).stiffness( 1 ).mode( 'field' )

void [road, coloredLine, packedLine, geometry, surfaceGeometry, material, surfaceMaterial, culling, gpuPath, trails, curves]
