package com.diagassist.technician

import android.content.Context
import org.json.JSONObject
import org.webrtc.AudioSource
import org.webrtc.AudioTrack
import org.webrtc.MediaConstraints
import org.webrtc.PeerConnection
import org.webrtc.PeerConnectionFactory
import org.webrtc.SdpObserver
import org.webrtc.SessionDescription
import org.webrtc.IceCandidate
import org.webrtc.PeerConnection.IceServer

class VoiceCallManager(
    private val context: Context,
    private val send: (String, JSONObject) -> Unit
) {
    private var factory: PeerConnectionFactory? = null
    private var peer: PeerConnection? = null
    private var audioSource: AudioSource? = null
    private var audioTrack: AudioTrack? = null

    init {
        PeerConnectionFactory.initialize(
            PeerConnectionFactory.InitializationOptions.builder(context).createInitializationOptions()
        )
        factory = PeerConnectionFactory.builder().createPeerConnectionFactory()
    }

    private fun ensurePeer(): PeerConnection {
        peer?.let { return it }
        val config = PeerConnection.RTCConfiguration(
            listOf(IceServer.builder("stun:stun.l.google.com:19302").createIceServer())
        )
        val pc = factory!!.createPeerConnection(config, object : PeerConnection.Observer {
            override fun onIceCandidate(candidate: IceCandidate) {
                send("voice_signal", JSONObject().apply {
                    put("kind", "ice")
                    put("candidate", JSONObject().apply {
                        put("sdpMid", candidate.sdpMid)
                        put("sdpMLineIndex", candidate.sdpMLineIndex)
                        put("candidate", candidate.sdp)
                    })
                })
            }
            override fun onSignalingChange(state: PeerConnection.SignalingState) {}
            override fun onIceConnectionChange(state: PeerConnection.IceConnectionState) {}
            override fun onIceConnectionReceivingChange(receiving: Boolean) {}
            override fun onIceGatheringChange(state: PeerConnection.IceGatheringState) {}
            override fun onIceCandidatesRemoved(candidates: Array<out IceCandidate>) {}
            override fun onAddStream(stream: org.webrtc.MediaStream) {}
            override fun onRemoveStream(stream: org.webrtc.MediaStream) {}
            override fun onDataChannel(channel: org.webrtc.DataChannel) {}
            override fun onRenegotiationNeeded() {}
            override fun onConnectionChange(newState: PeerConnection.PeerConnectionState) {}
            override fun onSelectedCandidatePairChanged(event: PeerConnection.PeerConnection.PeerConnectionState) {}
        }) ?: error("WebRTC peer impossible")
        peer = pc
        ensureAudioTrack(pc)
        return pc
    }

    private fun ensureAudioTrack(pc: PeerConnection) {
        if (audioTrack != null) return
        audioSource = factory!!.createAudioSource(MediaConstraints())
        audioTrack = factory!!.createAudioTrack("diagassist-microphone", audioSource)
        pc.addTrack(audioTrack)
    }

    fun startOutgoing() {
        val pc = ensurePeer()
        send("voice_start", JSONObject())
        pc.createOffer(object : SimpleSdpObserver() {
            override fun onCreateSuccess(desc: SessionDescription) {
                pc.setLocalDescription(SimpleSdpObserver(), desc)
                send("voice_signal", JSONObject().apply {
                    put("kind", "offer")
                    put("sdp", desc.description)
                })
            }
        }, MediaConstraints())
    }

    fun handleStart() {
        ensurePeer()
    }

    fun handleSignal(payload: JSONObject) {
        val pc = ensurePeer()
        when (payload.optString("kind")) {
            "offer" -> {
                val sdp = payload.optString("sdp")
                pc.setRemoteDescription(SimpleSdpObserver {
                    pc.createAnswer(object : SimpleSdpObserver() {
                        override fun onCreateSuccess(desc: SessionDescription) {
                            pc.setLocalDescription(SimpleSdpObserver(), desc)
                            send("voice_signal", JSONObject().apply {
                                put("kind", "answer")
                                put("sdp", desc.description)
                            })
                        }
                    }, MediaConstraints())
                }, SessionDescription(SessionDescription.Type.OFFER, sdp))
            }
            "answer" -> {
                pc.setRemoteDescription(
                    SimpleSdpObserver(),
                    SessionDescription(SessionDescription.Type.ANSWER, payload.optString("sdp"))
                )
            }
            "ice" -> {
                val c = payload.optJSONObject("candidate") ?: return
                pc.addIceCandidate(
                    IceCandidate(
                        c.optString("sdpMid"),
                        c.optInt("sdpMLineIndex"),
                        c.optString("candidate")
                    )
                )
            }
        }
    }

    fun stop() {
        audioTrack?.dispose()
        audioTrack = null
        audioSource?.dispose()
        audioSource = null
        peer?.close()
        peer = null
    }

    fun dispose() {
        stop()
        factory?.dispose()
        factory = null
    }

    open class SimpleSdpObserver(private val created: ((SessionDescription) -> Unit)? = null) : SdpObserver {
        override fun onCreateSuccess(desc: SessionDescription) { created?.invoke(desc) }
        override fun onSetSuccess() {}
        override fun onCreateFailure(error: String) {}
        override fun onSetFailure(error: String) {}
    }
}
