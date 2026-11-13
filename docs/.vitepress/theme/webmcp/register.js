// Registers tools with the browser's WebMCP model context.
//
// The current draft (webmachinelearning.github.io/webmcp) exposes
// `document.modelContext.registerTool( tool, { signal } )`: it returns a
// promise, unregisters when the signal aborts, calls `execute( input, { signal } )`
// and serialises whatever it returns to JSON.
// Chrome's early preview and the MCP-B polyfill expose `navigator.modelContext`
// instead, unregister with `unregisterTool( name )` or the returned handle, and
// expect an MCP result `{ content: [{ type: 'text', text }] }`.

export function findModelContext( scope = globalThis ) {
	const current = scope.document?.modelContext
	if ( typeof current?.registerTool === 'function' ) return { context: current, legacy: false }
	const legacy = scope.navigator?.modelContext
	if ( typeof legacy?.registerTool === 'function' ) return { context: legacy, legacy: true }
	return null
}

export function toMcpResult( value ) {
	const text = typeof value === 'string' ? value : JSON.stringify( value, null, 2 )
	const result = { content: [{ type: 'text', text: text ?? '' }] }
	if ( value && typeof value === 'object' && typeof value.error === 'string' ) result.isError = true
	return result
}

function legacyExecute( execute ) {
	return async input => {
		try {
			return toMcpResult( await execute( input ?? {}, {} ) )
		} catch ( error ) {
			return toMcpResult( { error: error?.message || String( error ) } )
		}
	}
}

function currentExecute( execute ) {
	return ( input, options ) => execute( input ?? {}, options ?? {} )
}

// Returns a function that unregisters every tool, or null without WebMCP.
export function registerTools( tools, { scope = globalThis, onError = () => {} } = {} ) {
	const found = findModelContext( scope )
	if ( !found ) return null
	const { context, legacy } = found
	const controller = new AbortController()
	const handles = []

	for ( const tool of tools ) {
		const definition = { ...tool, execute: legacy ? legacyExecute( tool.execute ) : currentExecute( tool.execute ) }
		try {
			const handle = Promise.resolve( context.registerTool( definition, { signal: controller.signal } ) )
			handle.catch( error => onError( tool.name, error ) )
			handles.push( { name: tool.name, handle } )
		} catch ( error ) {
			onError( tool.name, error )
		}
	}

	return () => {
		if ( controller.signal.aborted ) return
		controller.abort()
		if ( !legacy ) return
		for ( const { name, handle } of handles ) {
			handle.then( registration => {
				if ( typeof registration?.unregister === 'function' ) registration.unregister()
				else context.unregisterTool?.( name )
			} ).catch( () => {} )
		}
	}
}
