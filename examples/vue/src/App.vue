<script setup>
import { circlePositions } from 'makio-meshline'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three/webgpu'
import { onMounted, onUnmounted, reactive, ref, shallowRef } from 'vue'

import MeshLine from './MeshLine.vue'

const canvasRef = ref()
const group = shallowRef( null )
const viewport = reactive( { width: 1, height: 1 } )
const points = circlePositions( 64, 3 )
for ( let offset = 1; offset < points.length; offset += 3 ) points[offset] += 2

const roadPoints = new Float32Array( [-4.5, -2.2, 0, -2.4, -1.55, 0, -0.5, -2.35, 0, 1.8, -1.45, 0, 4.5, -2.05, 0] )
const roadSurface = {
	frame: 'fixed-up',
	up: [0, 0, 1],
	uvMode: 'distance',
	uvScale: 2,
	roughness: 0.72,
	metalness: 0.12,
}
const roadJoin = { type: 'round', limit: 3, segments: 10 }
const roadCap = { type: 'round', segments: 10 }

let renderer, scene, camera, controls
let disposed = false

onMounted( init )
onUnmounted( dispose )

async function init() {
	viewport.width = window.innerWidth
	viewport.height = window.innerHeight

	scene = new THREE.Scene()
	camera = new THREE.PerspectiveCamera( 55, viewport.width / viewport.height, 0.1, 100 )
	camera.position.z = 10

	renderer = new THREE.WebGPURenderer( { canvas: canvasRef.value, antialias: true } )
	renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) )
	renderer.setSize( viewport.width, viewport.height )
	await renderer.init()

	if ( disposed ) {
		renderer.dispose()
		return
	}

	controls = new OrbitControls( camera, renderer.domElement )
	controls.enableDamping = true

	group.value = new THREE.Group()
	scene.add( group.value )

	const keyLight = new THREE.DirectionalLight( 0xffffff, 2.5 )
	keyLight.position.set( 4, 7, 8 )
	scene.add( new THREE.HemisphereLight( 0xbfdcff, 0x202028, 1.4 ), keyLight )

	renderer.setAnimationLoop( animate )
	window.addEventListener( 'resize', onWindowResize )
}

function animate( time ) {
	controls.update()
	group.value.rotation.z = time * 0.0003
	renderer.render( scene, camera )
}

function onWindowResize() {
	viewport.width = window.innerWidth
	viewport.height = window.innerHeight

	camera.aspect = viewport.width / viewport.height
	camera.updateProjectionMatrix()
	renderer.setPixelRatio( Math.min( window.devicePixelRatio, 2 ) )
	renderer.setSize( viewport.width, viewport.height )
}

function dispose() {
	disposed = true
	window.removeEventListener( 'resize', onWindowResize )
	renderer?.setAnimationLoop( null )
	controls?.dispose()
	renderer?.dispose()
}
</script>

<template>
	<canvas ref="canvasRef" />
	<MeshLine
		v-if="group"
		:parent="group"
		:points="points"
		:render-width="viewport.width"
		:render-height="viewport.height"
		closed
		:line-width="0.2"
		:color="0xff8800"
		:gradient-color="0xffffff"
	/>
	<MeshLine
		v-if="group"
		:parent="group"
		:points="roadPoints"
		:surface="roadSurface"
		:join="roadJoin"
		:cap="roadCap"
		:line-width="0.7"
		:color="0x4aa8ff"
	/>
</template>
