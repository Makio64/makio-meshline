function createWorker( f ) {
	return new Worker( URL.createObjectURL( new Blob( [`(${f})()`] ) ) )
}

const worker = createWorker( () => {
	self.addEventListener( 'message', ( e ) => {
		let src = e.data
		fetch( src )
			.then( ( response ) => response.blob() )
			.then( ( blob ) => createImageBitmap( blob ) )
			.then( ( bitmap ) => {
				self.postMessage( { src, bitmap }, [bitmap] )
			} )
	} )
} )

export default function webworkerImageLoad( src ) {
	return new Promise( ( resolve, reject ) => {
		function handler( e ) {
			if ( e.data.src === src ) {
				worker.removeEventListener( 'message', handler )
				if ( e.data.error ) {
					reject( e.data.error )
				}
				resolve( e.data )
			}
		}
		worker.addEventListener( 'message', handler )
		worker.postMessage( src )
	} )
}
