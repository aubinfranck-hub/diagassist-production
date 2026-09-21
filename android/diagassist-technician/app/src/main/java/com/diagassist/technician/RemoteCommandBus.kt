package com.diagassist.technician

object RemoteCommandBus {
    @Volatile private var listener: ((String, String) -> Unit)? = null

    fun setListener(value: ((String, String) -> Unit)?) {
        listener = value
    }

    fun dispatch(action: String, payload: String) {
        listener?.invoke(action, payload)
    }
}
