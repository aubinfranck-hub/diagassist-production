package com.diagassist.technician

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONObject

class RemoteAccessibilityService : AccessibilityService() {
    companion object {
        @Volatile var instance: RemoteAccessibilityService? = null
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        RemoteCommandBus.setListener { action, payload -> handleCommand(action, payload) }
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        RemoteCommandBus.setListener(null)
        super.onDestroy()
    }

    override fun onAccessibilityEvent(event: android.view.accessibility.AccessibilityEvent?) = Unit
    override fun onInterrupt() = Unit

    private fun handleCommand(action: String, payload: String) {
        Handler(Looper.getMainLooper()).post { handleCommandOnMain(action, payload) }
    }

    private fun handleCommandOnMain(action: String, payload: String) {
        val ok = try {
            when (action) {
                "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
                "click" -> {
                    val data = JSONObject(payload)
                    val x = data.optFloat("x", -1f)
                    val y = data.optFloat("y", -1f)
                    if (x >= 0 && y >= 0) clickAt(x, y) else clickText(data.optString("text", ""))
                }
                "scroll" -> {
                    val data = JSONObject(payload)
                    scroll(data.optString("direction", "down"))
                }
                "input" -> {
                    val data = JSONObject(payload)
                    setFocusedText(data.optString("text", ""))
                }
                else -> false
            }
        } catch (_: Exception) {
            false
        }

        // L'accusé de réception est préparé ici pour le service de capture.
        // L'exécution reste locale au service Accessibility.
        ScreenCaptureServiceBridge.result(action, ok)
    }

    private fun clickAt(x: Float, y: Float): Boolean {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
            .build()
        return dispatchGesture(gesture, null, null)
    }

    private fun clickText(text: String): Boolean {
        if (text.isBlank()) return false
        val root = rootInActiveWindow ?: return false
        val nodes = root.findAccessibilityNodeInfosByText(text)
        return nodes.firstOrNull()?.performAction(AccessibilityNodeInfo.ACTION_CLICK) == true
    }

    private fun scroll(direction: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val scrollable = findScrollable(root) ?: return false
        val action = if (direction.equals("up", true)) {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        }
        return scrollable.performAction(action)
    }

    private fun setFocusedText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: findEditable(root)
            ?: return false
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        return focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
    }

    private fun findScrollable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isScrollable) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findScrollable(child)
            if (found != null) return found
        }
        return null
    }

    private fun findEditable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isEditable) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findEditable(child)
            if (found != null) return found
        }
        return null
    }
}

// Petit pont sans dépendance Android supplémentaire : l'agent de capture expose le dernier service actif.
object ScreenCaptureServiceBridge {
    @Volatile private var sender: ((String, Boolean) -> Unit)? = null

    fun register(value: ((String, Boolean) -> Unit)?) { sender = value }
    fun result(action: String, success: Boolean) { sender?.invoke(action, success) }
}
