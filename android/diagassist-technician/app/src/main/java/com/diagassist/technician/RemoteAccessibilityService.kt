package com.diagassist.technician

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.os.Bundle
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
        when (action) {
            "back" -> performGlobalAction(GLOBAL_ACTION_BACK)
            "click" -> {
                val data = runCatching { JSONObject(payload) }.getOrNull() ?: return
                val x = data.optFloat("x", -1f)
                val y = data.optFloat("y", -1f)
                if (x >= 0 && y >= 0) {
                    clickAt(x, y)
                } else {
                    clickText(data.optString("text", ""))
                }
            }
            "scroll" -> {
                val data = runCatching { JSONObject(payload) }.getOrNull() ?: return
                val direction = data.optString("direction", "down")
                scroll(direction)
            }
            "input" -> {
                val data = runCatching { JSONObject(payload) }.getOrNull() ?: return
                setFocusedText(data.optString("text", ""))
            }
        }
    }

    private fun clickAt(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
            .build()
        dispatchGesture(gesture, null, null)
    }

    private fun clickText(text: String) {
        if (text.isBlank()) return
        val root = rootInActiveWindow ?: return
        val nodes = root.findAccessibilityNodeInfosByText(text)
        nodes.firstOrNull()?.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }

    private fun scroll(direction: String) {
        val root = rootInActiveWindow ?: return
        val scrollable = findScrollable(root) ?: return
        val action = if (direction.equals("up", true)) {
            AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD
        } else {
            AccessibilityNodeInfo.ACTION_SCROLL_FORWARD
        }
        scrollable.performAction(action)
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

    private fun setFocusedText(text: String) {
        val root = rootInActiveWindow ?: return
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT)
            ?: findEditable(root)
            ?: return
        val args = Bundle().apply {
            putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        }
        focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
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
