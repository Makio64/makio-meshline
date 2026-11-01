export const pick = ( value, allowed ) => allowed.includes( value ) ? value : allowed[0]

const requestedMode = ( gpu, simplify, topology, cap ) => {
	if ( !gpu ) return 'cpu'
	if ( topology !== 'fixed' || cap !== 'butt' ) return 'gpu-topology'
	return simplify ? 'gpu-simplified' : 'gpu-raw'
}

/** The demo's flags: ?gpu=0 ?simplify=0 ?topology= ?cap= ?wireframe=1 ?metrics=1 */
export function readQuery() {
	const query = new URLSearchParams( window.location.search )
	const gpu = query.get( 'gpu' ) !== '0'
	const simplify = query.get( 'simplify' ) !== '0'
	const topology = pick( query.get( 'topology' ), ['fixed', 'variable', 'bevel', 'round'] )
	const cap = pick( query.get( 'cap' ), ['butt', 'square', 'round'] )
	return {
		gpu,
		simplify,
		topology,
		cap,
		mode: requestedMode( gpu, simplify, topology, cap ),
		wireframe: ['1', 'true'].includes( query.get( 'wireframe' ) ),
		metrics: query.get( 'metrics' ) === '1',
	}
}

export function writeMode( mode ) {
	const url = new URL( window.location.href )
	for ( const key of ['gpu', 'simplify', 'topology', 'cap'] ) url.searchParams.delete( key )
	if ( mode === 'gpu-raw' ) url.searchParams.set( 'simplify', '0' )
	if ( mode === 'cpu' ) url.searchParams.set( 'gpu', '0' )
	window.history.replaceState( null, '', url )
}

export function writeWireframe( enabled ) {
	const url = new URL( window.location.href )
	if ( enabled ) url.searchParams.set( 'wireframe', '1' )
	else url.searchParams.delete( 'wireframe' )
	window.history.replaceState( null, '', url )
}
