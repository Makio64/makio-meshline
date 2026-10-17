import DoubleLinkedList from '../utils/structures/DoubleLinkedList.js'
import ObjectPool from '../utils/structures/ObjectPool.js'

class SignalNode {
	constructor() {
		this.prev = null
		this.next = null
		this.listener = null
		this.signal = null
	}
}

export default class Signal {
	static POOL = new ObjectPool( () => new SignalNode(), 256 )

	constructor() {
		this.listeners = new DoubleLinkedList()
		this.listenersOnce = []
		this._nodes = new Map()
		this._cursor = null
	}

	add( listener ) {
		if ( typeof listener !== 'function' || !this.listeners || this._nodes.has( listener ) ) {
			return
		}
		const node = Signal.POOL.get()
		node.prev = null
		node.next = null
		node.listener = listener
		node.signal = this
		this._nodes.set( listener, node )

		this.listeners.add( node )
	}

	remove( listener ) {
		if ( !this._nodes || !this.listeners ) {
			return
		}
		const node = this._nodes.get( listener )
		if ( !node ) {
			return
		}
		if ( this._cursor === node ) {
			this._cursor = node.next
		}
		this._nodes.delete( listener )
		this.listeners.remove( node )
		node.prev = null
		node.next = null
		node.listener = null
		node.signal = null
		Signal.POOL.release( node )
	}

	once( listener ) {
		this.addOnce( listener )
	}

	addOnce( listener ) {
		if ( typeof listener !== 'function' || !this.listenersOnce ) {
			return
		}
		this.listenersOnce.push( listener )
	}

	dispatch() {
		if ( this.listenersOnce && this.listenersOnce.length > 0 ) {
			const once = this.listenersOnce
			this.listenersOnce = []
			for ( let i = 0; i < once.length; i++ ) {
				once[i].apply( null, arguments )
			}
		}

		if ( !this.listeners ) {
			return
		}

		let node = this.listeners.root
		while ( node ) {
			this._cursor = node.next
			const listener = node.listener
			if ( node.signal === this && listener ) {
				listener.apply( null, arguments )
			}
			node = this._cursor
		}
		this._cursor = null
	}

	dispose() {
		if ( !this.listeners ) {
			return
		}
		this.removeAll()
		this.listeners = null
		this.listenersOnce = null
		this._nodes = null
	}

	removeAll() {
		if ( !this.listeners ) {
			return
		}
		this._cursor = null
		let node = this.listeners.root
		while ( node ) {
			const next = node.next
			node.prev = null
			node.next = null
			node.listener = null
			node.signal = null
			Signal.POOL.release( node )
			node = next
		}
		this.listeners.reset()
		this._nodes.clear()
		this.listenersOnce = []
	}
}
