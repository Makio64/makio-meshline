const DEFAULT_MAX_PASSES = 5
const DEFAULT_TOLERANCE = 1e-4
const DEFAULT_PADDING = 2e-4
const LATERAL_SAMPLES = [0.25, 0.5, 0.75, 1]

const pointProgress = points => {
	const count = points.length / 3
	const distances = new Float64Array( count )
	for ( let index = 1; index < count; index++ ) {
		distances[index] = distances[index - 1] + Math.hypot(
			points[index * 3] - points[( index - 1 ) * 3],
			points[index * 3 + 1] - points[( index - 1 ) * 3 + 1],
			points[index * 3 + 2] - points[( index - 1 ) * 3 + 2]
		)
	}
	const total = distances[count - 1]
	if ( !( total > 0 ) ) throw new RangeError( '[roadClearance] Road length must be greater than zero' )
	for ( let index = 1; index < count; index++ ) distances[index] /= total
	return distances
}

const nearestProgressIndex = ( progress, value ) => {
	let lower = 0
	let upper = progress.length - 1
	while ( lower + 1 < upper ) {
		const middle = ( lower + upper ) >> 1
		if ( progress[middle] < value ) lower = middle
		else upper = middle
	}
	return value - progress[lower] <= progress[upper] - value ? lower : upper
}

const validateMeasurementInput = ( points, geometry, heightAt, minimumClearance ) => {
	if ( !points || points.length < 6 || points.length % 3 !== 0 ) {
		throw new TypeError( '[roadClearance] points must contain at least two XYZ rows' )
	}
	if ( !geometry?.getAttribute ) throw new TypeError( '[roadClearance] A built surface geometry is required' )
	if ( typeof heightAt !== 'function' ) throw new TypeError( '[roadClearance] heightAt must be a function' )
	if ( !Number.isFinite( minimumClearance ) || minimumClearance < 0 ) {
		throw new RangeError( '[roadClearance] minimumClearance must be non-negative' )
	}
}

/**
 * Measure the exact built ribbon rather than guessing its transported frame.
 * Each emitted miter vertex is checked, as are lateral samples between that
 * vertex and its centre row plus triangle centroids between adjacent rows.
 */
export function measureRoadSurfaceClearance( points, geometry, heightAt, minimumClearance = 0 ) {
	validateMeasurementInput( points, geometry, heightAt, minimumClearance )
	const position = geometry.getAttribute( 'position' )
	const vertexProgress = geometry.getAttribute( 'progress' )
	if ( !position || !vertexProgress ) {
		throw new Error( '[roadClearance] Surface geometry must expose position and progress attributes' )
	}

	const count = points.length / 3
	const progress = pointProgress( points )
	const lifts = new Float64Array( count )
	let maxLift = 0
	const measure = ( x, y, z, pathProgress, knownPointIndex = -1 ) => {
		const terrain = heightAt( x, z )
		if ( !Number.isFinite( terrain ) ) throw new TypeError( '[roadClearance] heightAt returned a non-finite value' )
		const lift = terrain + minimumClearance - y
		if ( lift <= 0 ) return
		const pointIndex = knownPointIndex >= 0
			? knownPointIndex
			: nearestProgressIndex( progress, Math.max( 0, Math.min( 1, pathProgress ) ) )
		lifts[pointIndex] = Math.max( lifts[pointIndex], lift )
		maxLift = Math.max( maxLift, lift )
	}

	for ( let index = 0; index < count; index++ ) {
		measure( points[index * 3], points[index * 3 + 1], points[index * 3 + 2], progress[index], index )
	}

	const positions = position.array
	const renderedProgress = vertexProgress.array
	for ( let vertex = 0; vertex < position.count; vertex++ ) {
		const offset = vertex * 3
		const rowProgress = renderedProgress[vertex]
		const pointIndex = nearestProgressIndex( progress, rowProgress )
		const centerOffset = pointIndex * 3
		const centerX = points[centerOffset]
		const centerY = points[centerOffset + 1]
		const centerZ = points[centerOffset + 2]
		const dx = positions[offset] - centerX
		const dy = positions[offset + 1] - centerY
		const dz = positions[offset + 2] - centerZ
		for ( const fraction of LATERAL_SAMPLES ) {
			measure(
				centerX + dx * fraction,
				centerY + dy * fraction,
				centerZ + dz * fraction,
				rowProgress,
				pointIndex
			)
		}
	}

	const indices = geometry.getIndex()?.array
	if ( indices ) {
		for ( let offset = 0; offset < indices.length; offset += 3 ) {
			const first = indices[offset]
			const second = indices[offset + 1]
			const third = indices[offset + 2]
			const a = first * 3
			const b = second * 3
			const c = third * 3
			measure(
				( positions[a] + positions[b] + positions[c] ) / 3,
				( positions[a + 1] + positions[b + 1] + positions[c + 1] ) / 3,
				( positions[a + 2] + positions[b + 2] + positions[c + 2] ) / 3,
				( renderedProgress[first] + renderedProgress[second] + renderedProgress[third] ) / 3
			)
		}
	}

	return { lifts, maxLift }
}

export function spreadRoadClearanceToControls( sampleLifts, anchors ) {
	if ( !sampleLifts || !anchors || anchors.length < 2 ) {
		throw new TypeError( '[roadClearance] sample lifts and at least two anchors are required' )
	}
	const controlLifts = new Float64Array( anchors.length )
	let segment = 0
	for ( let sample = 0; sample < sampleLifts.length; sample++ ) {
		const lift = sampleLifts[sample]
		if ( !( lift > 0 ) ) continue
		while ( segment < anchors.length - 2 && sample > anchors[segment + 1] ) segment++
		controlLifts[segment] = Math.max( controlLifts[segment], lift )
		controlLifts[segment + 1] = Math.max( controlLifts[segment + 1], lift )
	}
	return controlLifts
}

/**
 * Raise whole authored spans, then re-plan, instead of clamping individual
 * samples. The returned centreline therefore still obeys every planner budget.
 */
export function fitRoadControlsToSurface( controls, planPath, inspectPlan, options = {} ) {
	if ( typeof planPath !== 'function' || typeof inspectPlan !== 'function' ) {
		throw new TypeError( '[roadClearance] planPath and inspectPlan must be functions' )
	}
	const maxPasses = options.maxPasses ?? DEFAULT_MAX_PASSES
	const tolerance = options.tolerance ?? DEFAULT_TOLERANCE
	const padding = options.padding ?? DEFAULT_PADDING
	if ( !Number.isInteger( maxPasses ) || maxPasses < 1 ) {
		throw new RangeError( '[roadClearance] maxPasses must be a positive integer' )
	}
	if ( !Number.isFinite( tolerance ) || tolerance < 0 || !Number.isFinite( padding ) || padding < 0 ) {
		throw new RangeError( '[roadClearance] tolerance and padding must be non-negative' )
	}

	const fittedControls = controls.map( control => ( {
		x: control.x,
		y: control.y ?? 0,
		z: control.z,
		bank: control.bank ?? control.roll ?? 0,
	} ) )
	let plan = null
	let measurement = null

	for ( let pass = 0; pass < maxPasses; pass++ ) {
		plan = planPath( fittedControls )
		if ( !plan ) return { plan: null, controls: fittedControls, converged: true, passes: pass + 1, maxLift: 0 }
		measurement = inspectPlan( plan )
		if ( measurement.maxLift <= tolerance ) {
			return {
				plan,
				controls: fittedControls,
				converged: true,
				passes: pass + 1,
				maxLift: measurement.maxLift,
			}
		}
		if ( pass + 1 === maxPasses ) break

		const controlLifts = spreadRoadClearanceToControls( measurement.lifts, plan.anchors )
		for ( let index = 0; index < controlLifts.length; index++ ) {
			const controlIndex = plan.controlIndices?.[index] ?? index
			if ( controlLifts[index] > 0 ) fittedControls[controlIndex].y += controlLifts[index] + padding
		}
	}

	return {
		plan,
		controls: fittedControls,
		converged: false,
		passes: maxPasses,
		maxLift: measurement?.maxLift ?? Infinity,
	}
}
