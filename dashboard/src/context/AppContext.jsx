import { createContext, useContext, useReducer } from 'react'

const AppContext = createContext(null)

const initialState = {
  nodes:        [],   // NodeHealth[]
  activeAlerts: [],   // EventLog[]  (last 100)
  sbcStatus:    {},   // { [nodeId]: SBCHeartbeat }
}

function reducer(state, action) {
  switch (action.type) {
    case 'SET_NODES':
      return { ...state, nodes: action.payload }

    case 'UPDATE_NODE': {
      const idx = state.nodes.findIndex(n => n.node_id === action.payload.node_id)
      if (idx === -1) return { ...state, nodes: [...state.nodes, action.payload] }
      const nodes = [...state.nodes]
      nodes[idx] = action.payload
      return { ...state, nodes }
    }

    case 'SET_ALERTS':
      return { ...state, activeAlerts: action.payload }

    case 'ADD_ALERT':
      return { ...state, activeAlerts: [action.payload, ...state.activeAlerts].slice(0, 100) }

    case 'UPDATE_SBC':
      return { ...state, sbcStatus: { ...state.sbcStatus, [action.payload.node_id]: action.payload } }

    default:
      return state
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return (
    <AppContext.Provider value={{ state, dispatch }}>
      {children}
    </AppContext.Provider>
  )
}

export function useApp() {
  return useContext(AppContext)
}
