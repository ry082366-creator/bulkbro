import { initializeApp } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
const firebaseConfig={apiKey:'AIzaSyDFMjkIvYi6GbOID92Tfv806DiWyBu526Q',authDomain:'bulkbro-e3aaa.firebaseapp.com',projectId:'bulkbro-e3aaa',storageBucket:'bulkbro-e3aaa.firebasestorage.app',messagingSenderId:'616302920063',appId:'1:616302920063:web:6bcc7244e303cdfd741a4a'}
const app=initializeApp(firebaseConfig)
export const auth=getAuth(app)
export const googleProvider=new GoogleAuthProvider()
export const db=getFirestore(app)
