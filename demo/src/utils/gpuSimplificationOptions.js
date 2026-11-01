/** The lab's URL options: dataset, level, lineWidth, radius, relax, render, view, cameraLod and validate. */
import { MathUtils } from 'three/webgpu'

import { VECTOR_DATASETS } from '@/data/vectorDatasets'
import { RELAX_MAX_ITERATIONS, SIMPLIFICATION_LEVEL_MAX } from '@/utils/gpuSimplification'

export const DEFAULT_RADIUS = 120
// Contour lines show off the relax + simplify pass best; France is one click away.
const DEFAULT_DATASET = 'isolines'
const RENDER_MODES = new Map( [['line', 'lines'], ['lines', 'lines'], ['wireframe', 'wireframe']] )

const queryNumber = ( query, key, fallback, minimum, maximum ) => {
	if ( !query.has( key ) ) return fallback
	const value = Number( query.get( key ) )
	return Number.isFinite( value ) ? MathUtils.clamp( value, minimum, maximum ) : fallback
}

export const readOptions = () => {
	const query = new URLSearchParams( window.location.search )
	const dataset = query.get( 'dataset' )
	return {
		cameraLod: query.get( 'cameraLod' ) === '1',
		datasetId: VECTOR_DATASETS.some( ( { id } ) => id === dataset ) ? dataset : DEFAULT_DATASET,
		detail: query.get( 'view' ) === 'original' ? 'before' : 'after',
		level: queryNumber( query, 'level', 58, 0, SIMPLIFICATION_LEVEL_MAX ),
		lineWidth: Math.round( queryNumber( query, 'lineWidth', 0.44, 0.05, 2 ) * 100 ) / 100,
		radius: queryNumber( query, 'radius', DEFAULT_RADIUS, 20, 320 ),
		relaxIterations: Math.round( queryNumber( query, 'relax', 4, 0, RELAX_MAX_ITERATIONS ) ),
		renderMode: RENDER_MODES.get( query.get( 'render' ) ) ?? 'ribbons',
		validateAgainstCpu: query.get( 'validate' ) === '1',
	}
}
