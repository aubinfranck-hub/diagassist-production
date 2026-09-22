package com.diagassist.technician
import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.core.content.ContextCompat

class MainActivity:ComponentActivity(){
 private val requestCode=9001
 private val microphoneCode=9002
 private var launchUri:Uri?=null
 private var projectionResult=0
 private var projectionData:Intent?=null

 override fun onCreate(state:Bundle?){super.onCreate(state); launchUri=intent?.data; requestProjection()}
 private fun requestProjection(){val m=getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager; startActivityForResult(m.createScreenCaptureIntent(),requestCode)}

 override fun onActivityResult(code:Int,result:Int,data:Intent?){
  super.onActivityResult(code,result,data)
  if(code!=requestCode||result!=Activity.RESULT_OK||data==null)return
  projectionResult=result
  projectionData=data
  if(ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){
   requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO),microphoneCode)
  } else startAgent()
 }

 override fun onRequestPermissionsResult(requestCode:Int,permissions:Array<out String>,grantResults:IntArray){
  super.onRequestPermissionsResult(requestCode,permissions,grantResults)
  if(requestCode==microphoneCode && projectionData!=null) startAgent()
 }

 private fun startAgent(){
  val u=launchUri
  val token=u?.getQueryParameter("token")?:""
  val session=u?.getQueryParameter("sessionId")?:""
  val pairing=u?.getQueryParameter("pairingCode")?:""
  val ws=u?.getQueryParameter("wsUrl") ?: "https://diagassist-production.onrender.com"
  startForegroundService(Intent(this,ScreenCaptureService::class.java).apply{
   putExtra("resultCode",projectionResult)
   putExtra("resultData",projectionData)
   putExtra("token",token)
   putExtra("sessionId",session)
   putExtra("pairingCode",pairing)
   putExtra("wsUrl",ws)
  })
  finish()
 }
}
