package com.diagassist.technician
import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity

class MainActivity:ComponentActivity(){
 private val requestCode=9001
 private var launchUri:Uri?=null
 override fun onCreate(state:Bundle?){super.onCreate(state); launchUri=intent?.data; requestProjection()}
 private fun requestProjection(){val m=getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager; startActivityForResult(m.createScreenCaptureIntent(),requestCode)}
 override fun onActivityResult(code:Int,result:Int,data:Intent?){super.onActivityResult(code,result,data); if(code!=requestCode||result!=Activity.RESULT_OK||data==null)return
  val u=launchUri; val token=u?.getQueryParameter("token")?:""; val session=u?.getQueryParameter("sessionId")?:""; val pairing=u?.getQueryParameter("pairingCode")?:""; val ws=u?.getQueryParameter("wsUrl")?:"wss://diagassist.com"
  startForegroundService(Intent(this,ScreenCaptureService::class.java).apply{putExtra("resultCode",result);putExtra("resultData",data);putExtra("token",token);putExtra("sessionId",session);putExtra("pairingCode",pairing);putExtra("wsUrl",ws)})
  finish()
 }
}