import { circlePositions, MeshLine } from 'makio-meshline'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three/webgpu'

let camera, scene, renderer, controls, line

init()

async function init() {
	camera = new THREE.PerspectiveCamera( 55, window.innerWidth / window.innerHeight, 0.1, 100 )
	camera.position.z = 10

	scene = new THREE.Scene()

	line = new MeshLine()
		.lines( circlePositions( 64, 3 ), true )
		.lineWidth( 0.2 )
		.color( 0xff8800 )
		.gradientColor( 0xffffff )
	scene.add( line )

	renderer = new THREE.WebGPURenderer( { antialias: true } )
	renderer.setPixelRatio( window.devicePixelRatio )
	renderer.setSize( window.innerWidth, window.innerHeight )
	await renderer.init()
	document.body.appendChild( renderer.domElement )

	controls = new OrbitControls( camera, renderer.domElement )
	controls.enableDamping = true

	window.addEventListener( 'resize', onWindowResize )
	renderer.setAnimationLoop( animate )
}

function onWindowResize() {
	camera.aspect = window.innerWidth / window.innerHeight
	camera.updateProjectionMatrix()
	renderer.setSize( window.innerWidth, window.innerHeight )
	line.resize( window.innerWidth, window.innerHeight )
}

function animate() {
	controls.update()
	renderer.render( scene, camera )
}
