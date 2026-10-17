import { circlePositions, MeshLine } from 'makio-meshline'
import {
	AmbientLight,
	BackSide,
	Mesh,
	MeshStandardMaterial,
	PCFSoftShadowMap,
	SphereGeometry,
	SpotLight,
} from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'

import stage from '@/makio/core/stage'
import OrbitControl from '@/makio/three/controls/OrbitControl'
import stage3d from '@/makio/three/stage3d'

// Pure red, green and blue lights on white surfaces: where one ring blocks a
// light, the other two mix, so every shadow comes out cyan, magenta or yellow.
const LIGHT_COLORS = [0xff3b3b, 0x3bff5e, 0x3b6bff]
const LIGHT_CONFIGS = [
	{ radius: 10, phiSpeed: 0.2, thetaSpeed: 0.3, phiOffset: 0, thetaOffset: 0, phiAmp: 0.3 },
	{ radius: 9, phiSpeed: 0.35, thetaSpeed: 0.5, phiOffset: Math.PI * 0.5, thetaOffset: Math.PI * 2 / 3, phiAmp: 0.4 },
	{ radius: 8, phiSpeed: 0.5, thetaSpeed: 0.7, phiOffset: Math.PI, thetaOffset: Math.PI * 4 / 3, phiAmp: 0.5 }
]
const CIRCLE_CONFIGS = [
	{ radius: 2.3, dashCount: 24, dashRatio: 0.55, color: 0x15161C, width: 0.14 },
	{ radius: 3.0, dashCount: 36, dashRatio: 0.45, color: 0x1C1E26, width: 0.11 },
	{ radius: 3.7, dashCount: 52, dashRatio: 0.38, color: 0x23252F, width: 0.09 }
]
const SCULPTURE_RADIUS = 4.1

class ShadowExample {
	constructor() {
		this.lines = []
		this.dashOffsets = []
		this.lights = []
		this.ambientLight = null
		this.control = null
		this.time = 0
		this.sphere = null
		this.background = null
		this.hud = null
		this.hudStyle = null
		this.previousShadowState = null
	}

	async init() {
		await stage3d.initRender( { background: 0xF4F1EA } )
		this.previousShadowState = {
			enabled: stage3d.renderer.shadowMap.enabled,
			type: stage3d.renderer.shadowMap.type,
			transmitted: stage3d.renderer.shadowMap.transmitted,
		}
		stage3d.renderer.shadowMap.enabled = true
		stage3d.renderer.shadowMap.type = PCFSoftShadowMap
		stage3d.renderer.shadowMap.transmitted = true

		this.control = new OrbitControl( stage3d.camera, 10 )
		this.control._phi = 1.12
		this.control._theta = 0.78
		this.control.maxRadius = 26
		this.control.minRadius = 6
		stage3d.control = this.control
		this.fitCamera()

		this.initBackground()
		this.initLights()
		this.initSphere()
		this.createSculpture()
		this.createHud()

		stage.onUpdate.add( this.update )
		stage.onResize.add( this.onResize )
	}

	initBackground() {
		this.background = new Mesh(
			new SphereGeometry( 8, 64, 48 ),
			// A white room: the colored lights paint it and the rings print on it.
			new MeshStandardNodeMaterial( {
				color: 0xFFFFFF,
				roughness: 0.92,
				metalness: 0,
				side: BackSide,
			} )
		)
		this.background.receiveShadow = true
		stage3d.add( this.background )
	}

	initLights() {
		this.ambientLight = new AmbientLight( 0xFFFFFF, 0.18 )
		stage3d.add( this.ambientLight )

		LIGHT_CONFIGS.forEach( ( config, index ) => {
			const light = new SpotLight( LIGHT_COLORS[index], 30 )
			light.angle = Math.PI / 4.5
			light.penumbra = 0.55
			light.decay = 1.4
			light.castShadow = true
			light.shadow.mapSize.set( 512, 512 )
			light.shadow.camera.near = 0.5
			light.shadow.camera.far = 40
			light.shadow.bias = -0.0003
			light.shadow.radius = 4

			light.target.position.set( 0, 0, 0 )
			stage3d.add( light.target )
			stage3d.add( light )
			this.lights.push( light )
		} )
	}

	initSphere() {
		const geometry = new SphereGeometry( 1.4, 64, 48 )
		const material = new MeshStandardMaterial( {
			color: 0xFFFFFF,
			roughness: 0.45,
			metalness: 0,
		} )
		this.sphere = new Mesh( geometry, material )
		this.sphere.receiveShadow = true
		stage3d.add( this.sphere )
	}

	createSculpture() {
		CIRCLE_CONFIGS.forEach( config => {
			const line = new MeshLine()
				.lines( circlePositions( 200, config.radius ), true )
				.color( config.color )
				.lineWidth( config.width )
				.dash( { count: config.dashCount, ratio: config.dashRatio } )
				.shadow( true, true )

			stage3d.add( line )
			this.lines.push( line )
			this.dashOffsets.push( 0 )
		} )
	}

	createHud() {
		if ( new URLSearchParams( window.location.search ).has( 'noUI' ) ) return
		this.hudStyle = document.createElement( 'style' )
		this.hudStyle.textContent = `
			.ShadowHud {
				position: fixed;
				left: calc(16px + var(--sail, 0px));
				top: calc(16px + var(--sait, 0px));
				z-index: 20;
				padding: 9px 12px;
				border: 1px solid rgba(174, 212, 255, .2);
				border-radius: 999px;
				background: rgba(6, 9, 17, .66);
				box-shadow: 0 12px 36px rgba(0, 0, 0, .28);
				backdrop-filter: blur(9px);
				color: rgba(231, 242, 255, .84);
				font: 650 10px/1 system-ui, sans-serif;
				letter-spacing: .08em;
				text-transform: uppercase;
				pointer-events: none;
			}
			.ShadowHud::before {
				content: '';
				display: inline-block;
				width: 7px;
				height: 7px;
				margin-right: 8px;
				border-radius: 50%;
				background: linear-gradient(135deg, #ffc76b, #7ee7ff);
				box-shadow: 0 0 12px rgba(126, 231, 255, .55);
				vertical-align: -1px;
			}
			@media (max-width: 600px) {
				.ShadowHud { left: calc(10px + var(--sail, 0px)); top: calc(10px + var(--sait, 0px)); font-size: 9px; }
			}
		`
		document.head.appendChild( this.hudStyle )

		this.hud = document.createElement( 'aside' )
		this.hud.className = 'ShadowHud'
		this.hud.textContent = 'Live cast + receive · 3 moving spotlights'
		document.body.appendChild( this.hud )
	}

	update = ( dt ) => {
		this.time += dt * 0.001

		for ( let i = 0; i < this.lines.length; i++ ) {
			const line = this.lines[i]
			line.rotation.x = this.time * ( 0.15 + i * 0.1 )
			line.rotation.y = this.time * ( 0.1 + i * 0.05 )

			this.dashOffsets[i] -= dt * ( 0.001 + i * 0.0005 )
			if ( line.material.dashOffset ) {
				line.material.dashOffset.value = this.dashOffsets[i]
			}
		}

		for ( let i = 0; i < this.lights.length; i++ ) {
			const light = this.lights[i]
			const config = LIGHT_CONFIGS[i]
			if ( !config ) continue

			const phi = Math.PI * 0.3 + Math.sin( this.time * config.phiSpeed + config.phiOffset ) * config.phiAmp
			const theta = this.time * config.thetaSpeed + config.thetaOffset
			light.position.x = config.radius * Math.sin( phi ) * Math.cos( theta )
			light.position.y = config.radius * Math.cos( phi )
			light.position.z = config.radius * Math.sin( phi ) * Math.sin( theta )
		}
	}

	fitCamera() {
		if ( !this.control ) return
		const halfFov = stage3d.camera.fov * Math.PI / 360
		const portraitFit = SCULPTURE_RADIUS / ( Math.tan( halfFov ) * stage3d.camera.aspect )
		const radius = Math.min( this.control.maxRadius, Math.max( 10, portraitFit ) )
		this.control.radius = radius
		this.control._radius = radius
		this.control.update()
	}

	onResize = () => {
		this.lines.forEach( line => line.resize() )
		this.fitCamera()
	}

	dispose() {
		stage.onUpdate.remove( this.update )
		stage.onResize.remove( this.onResize )
		this.hud?.remove()
		this.hudStyle?.remove()
		this.hud = null
		this.hudStyle = null

		if ( this.background ) {
			stage3d.remove( this.background )
			this.background.geometry.dispose()
			this.background.material.dispose()
			this.background = null
		}

		if ( this.sphere ) {
			stage3d.remove( this.sphere )
			this.sphere.geometry.dispose()
			this.sphere.material.dispose()
			this.sphere = null
		}

		this.lines.forEach( line => {
			stage3d.remove( line )
			line.dispose()
		} )
		this.lines = []
		this.dashOffsets = []

		this.lights.forEach( light => {
			light.target.parent?.remove( light.target )
			light.parent?.remove( light )
			light.shadow.map?.dispose()
			light.dispose()
		} )
		this.lights = []

		if ( this.ambientLight ) {
			stage3d.remove( this.ambientLight )
			this.ambientLight.dispose()
			this.ambientLight = null
		}

		if ( this.previousShadowState ) {
			stage3d.renderer.shadowMap.enabled = this.previousShadowState.enabled
			stage3d.renderer.shadowMap.type = this.previousShadowState.type
			stage3d.renderer.shadowMap.transmitted = this.previousShadowState.transmitted
			this.previousShadowState = null
		}
		this.control?.dispose()
		if ( stage3d.control === this.control ) stage3d.control = null
		this.control = null
	}

}

export default ShadowExample
