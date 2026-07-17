import '../styles/fonts.css'
import '../styles/tokens.css'
import '../styles/public.css'
import { tohuLogo } from '../components/logo'

const brand = document.querySelector<HTMLElement>('#brand')
if (brand) brand.innerHTML = tohuLogo()
