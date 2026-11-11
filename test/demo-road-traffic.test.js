import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Exercise the actual traffic and Three.js instances, with only the browser's scene host omitted.
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from( source ).toString( 'base64' )}`
const resolveImport = specifier => specifier.startsWith( '@/' )
	? new URL( `../demo/src/${specifier.slice( 2 )}.js`, import.meta.url ).href
	: import.meta.resolve( specifier )
const route = moduleUrl( ( await readFile( new URL( '../demo/src/utils/surfaceRoadRoute.js', import.meta.url ), 'utf8' ) )
	.replace( /from '([^']+)'/g, ( _, specifier ) => `from '${resolveImport( specifier )}'` ) )
const scene = moduleUrl( 'export default { add() {} }' )
const source = ( await readFile( new URL( '../demo/src/utils/surfaceRoadTraffic.js', import.meta.url ), 'utf8' ) )
	.replace( /from '([^']+)'/g, ( _, specifier ) => {
		const url = specifier === '@/makio/three/stage3d' ? scene : specifier === '@/utils/surfaceRoadRoute' ? route : resolveImport( specifier )
		return `from '${url}'`
	} )
const previousWindow = globalThis.window
globalThis.window = { fxseed: 'road-traffic', fxrand: () => 0.5 }
let RoadTraffic
try {
	const module = await import( moduleUrl( source ) )
	RoadTraffic = module.RoadTraffic
} finally {
	if ( previousWindow === undefined ) delete globalThis.window
	else globalThis.window = previousWindow
}

const circle = radius => {
	const segments = 192
	const points = new Float32Array( ( segments + 3 ) * 3 )
	for ( let row = -1; row <= segments + 1; row++ ) {
		const angle = row / segments * Math.PI * 2
		points.set( [Math.cos( angle ) * radius, 0, Math.sin( angle ) * radius], ( row + 1 ) * 3 )
	}
	return { closed: true, points, bank: new Float32Array( segments + 3 ) }
}

const createTraffic = t => {
	const traffic = new RoadTraffic()
	t.after( () => {
		for ( const mesh of traffic.meshes ) {
			mesh.geometry.dispose()
			mesh.dispose()
		}
		for ( const material of new Set( traffic.meshes.map( mesh => mesh.material ) ) ) material.dispose()
	} )
	return traffic
}

const assertSeparated = traffic => {
	for ( const lane of [0, 1] ) {
		const phases = traffic.cars.slice( 0, traffic.active ).filter( ( _, index ) => index % 2 === lane )
			.map( car => car.phase - lane * traffic.length ).sort( ( a, b ) => a - b )
		for ( let index = 0; index < phases.length; index++ ) {
			const gap = ( phases[( index + 1 ) % phases.length] - phases[index] + traffic.length ) % traffic.length
			if ( phases.length > 1 ) assert.ok( gap > 3, `cars overlap in lane ${lane}: ${gap}m gap` )
		}
	}
}

test( 'traffic grows and shrinks with the circuit while reusing its instanced buffers', t => {
	const traffic = createTraffic( t )
	const buffers = traffic.meshes.map( mesh => mesh.instanceMatrix )
	const counts = []
	for ( const radius of [8, 24, 48, 200, 8] ) {
		traffic.setRoute( circle( radius ), 1.15 )
		counts.push( traffic.active )
		traffic.meshes.forEach( ( mesh, index ) => {
			assert.equal( mesh.instanceMatrix, buffers[index], 'editing the circuit must retain its GPU buffer' )
			assert.equal( mesh.count, traffic.active * ( mesh === traffic.wheels ? 4 : 1 ) )
			assert.ok( mesh.count <= mesh.instanceMatrix.count )
		} )
		assertSeparated( traffic )
	}
	assert.ok( counts[0] < counts[1] )
	assert.ok( counts[1] >= 4 && counts[1] <= 8, 'an ordinary circuit should carry a handful of cars' )
	assert.ok( counts[1] < counts[2] )
	assert.ok( counts[2] < counts[3] )
	assert.ok( counts[3] <= 20, 'very large circuits must not turn into a crowd of cars' )
	assert.equal( counts[4], counts[0], 'shrinking the circuit must remove the extra cars' )

	traffic.setRoute( circle( 2.5 ), 1.15 )
	assert.equal( traffic.active, 2, 'a short drivable loop keeps one car in each direction' )
	traffic.setRoute( circle( 1 ), 1.15 )
	assert.equal( traffic.active, 0, 'a circuit too short to drive hides traffic' )
} )

test( 'cars hold a moderate pace through continuous bends and stay separated over repeated laps', t => {
	const traffic = createTraffic( t )
	traffic.setRoute( circle( 24 ), 1.15 )
	for ( let frame = 0; frame < 600; frame++ ) {
		traffic.update( 16 )
		if ( frame % 30 === 0 ) assertSeparated( traffic )
	}
	for ( const car of traffic.cars.slice( 0, traffic.active ) ) {
		assert.ok( car.speed > 14, `a car should still make steady progress, saw ${car.speed}m/s` )
		assert.ok( car.speed < 24, `Edit and Follow should stay relaxed, saw ${car.speed}m/s` )
		assert.ok( car.body.elements.every( Number.isFinite ), 'the car must retain a valid pose' )
	}
	assertSeparated( traffic )

	// Resizing while moving must leave every car on its lane, including newly activated slots.
	for ( const radius of [48, 8, 24] ) {
		traffic.setRoute( circle( radius ), 1.15 )
		for ( let frame = 0; frame < 60; frame++ ) traffic.update( 16 )
		assertSeparated( traffic )
		assert.ok( traffic.cars.slice( 0, traffic.active ).every( car => Number.isFinite( car.speed ) && Number.isFinite( car.phase ) ) )
	}
} )

test( 'Drive slows traffic down, and leaving it immediately restores its pace without a position jump', t => {
	const traffic = createTraffic( t )
	traffic.setRoute( circle( 24 ), 1.15 )
	const travel = frames => {
		let metres = 0
		for ( let frame = 0; frame < frames; frame++ ) {
			const before = traffic.cars[0].phase
			traffic.update( 16 )
			metres += ( traffic.cars[0].phase - before + traffic.length ) % traffic.length
			assertSeparated( traffic )
		}
		return metres
	}
	travel( 600 )
	const calmDistance = travel( 120 )
	const count = traffic.active
	const phases = traffic.cars.map( car => car.phase )
	const calmSpeed = traffic.cars[0].speed
	traffic.setDriving( true )
	assert.deepEqual( traffic.cars.map( car => car.phase ), phases, 'entering Drive must not teleport traffic' )
	assert.equal( traffic.active, count, 'Drive changes pace, not traffic density' )
	assert.ok( traffic.cars[0].speed < calmSpeed * 0.65 && traffic.cars[0].speed > calmSpeed * 0.55, 'Drive should take up its slower pace immediately' )
	const driveDistance = travel( 120 )
	assert.ok( driveDistance < calmDistance * 0.7 && driveDistance > calmDistance * 0.5, `Drive travelled ${driveDistance}m versus ${calmDistance}m outside the car` )
	assert.ok( traffic.cars.slice( 0, count ).every( car => car.speed < 16 ), 'the driver must be able to read the dashboard through bends' )

	const drivePhases = traffic.cars.map( car => car.phase )
	traffic.setDriving( false )
	assert.deepEqual( traffic.cars.map( car => car.phase ), drivePhases, 'leaving Drive must not teleport traffic' )
	assert.ok( traffic.cars.slice( 0, count ).every( car => car.speed < 24 && car.speed > 14 ), 'Edit and Follow must take their own pace back as soon as Drive ends' )
	const restoredDistance = travel( 120 )
	assert.ok( restoredDistance > driveDistance * 1.4 )
	assert.ok( Math.abs( restoredDistance - calmDistance ) < calmDistance * 0.05, 'leaving Drive should recover the original motion' )
	assert.ok( traffic.cars.slice( 0, count ).every( car => car.body.elements.every( Number.isFinite ) ) )

	const speed = traffic.cars[0].speed
	traffic.setDriving( false )
	assert.equal( traffic.cars[0].speed, speed, 'switching between the two calm views must not rescale speed again' )
} )
