import {
  Apple, Baby, Banknote, BedDouble, Bike, Bird, BookOpen, Briefcase, Bus,
  CakeSlice, Camera, Car, Cat, Clapperboard, Coffee, Coins, CookingPot,
  CreditCard, Dog, Droplets, Dumbbell, Flower2, Folder, Fuel, Gamepad2,
  Gem, Gift, GraduationCap, HandCoins, Heart, HeartPulse, House, Landmark,
  Leaf, Mail, Moon, Music, Package, PawPrint, Pill, Plane, Rabbit, Receipt,
  Scissors, ShieldCheck, Shirt, ShoppingBag, ShoppingCart, Smartphone,
  Smile, Sofa, Sprout, Star, Stethoscope, Sun, TrainFront, TrendingUp,
  UserRound, Utensils, Wallet, Wifi, Wrench, Zap, type LucideIcon,
} from "lucide-react";
import { isCategoryIcon, isMemberAvatar, DEFAULT_CATEGORY_ICON, DEFAULT_MEMBER_AVATAR, MEMBER_AVATAR_TEXT } from "@/lib/entity-icon-catalog";
import { cn } from "@/lib/utils";
import { FamilyAvatarIcon } from "@/components/icons/family-avatar-icon";

// Explicit imports keep the selectable set small and avoid loading every Lucide icon.
const icons: Record<string, LucideIcon> = {
  "lucide:apple": Apple, "lucide:baby": Baby, "lucide:banknote": Banknote,
  "lucide:bed-double": BedDouble, "lucide:bike": Bike, "lucide:bird": Bird,
  "lucide:book-open": BookOpen, "lucide:briefcase": Briefcase, "lucide:bus": Bus,
  "lucide:cake-slice": CakeSlice, "lucide:camera": Camera, "lucide:car": Car,
  "lucide:cat": Cat, "lucide:clapperboard": Clapperboard, "lucide:coffee": Coffee,
  "lucide:coins": Coins, "lucide:cooking-pot": CookingPot, "lucide:credit-card": CreditCard,
  "lucide:dog": Dog, "lucide:droplets": Droplets, "lucide:dumbbell": Dumbbell,
  "lucide:flower-2": Flower2, "lucide:folder": Folder, "lucide:fuel": Fuel,
  "lucide:gamepad-2": Gamepad2, "lucide:gem": Gem, "lucide:gift": Gift,
  "lucide:graduation-cap": GraduationCap, "lucide:hand-coins": HandCoins,
  "lucide:heart": Heart, "lucide:heart-pulse": HeartPulse, "lucide:house": House,
  "lucide:landmark": Landmark, "lucide:leaf": Leaf, "lucide:mail": Mail,
  "lucide:moon": Moon, "lucide:music": Music, "lucide:package": Package,
  "lucide:paw-print": PawPrint, "lucide:pill": Pill, "lucide:plane": Plane,
  "lucide:rabbit": Rabbit, "lucide:receipt": Receipt, "lucide:scissors": Scissors,
  "lucide:shield-check": ShieldCheck, "lucide:shirt": Shirt,
  "lucide:shopping-bag": ShoppingBag, "lucide:shopping-cart": ShoppingCart,
  "lucide:smartphone": Smartphone, "lucide:smile": Smile, "lucide:sofa": Sofa,
  "lucide:sprout": Sprout, "lucide:star": Star, "lucide:stethoscope": Stethoscope,
  "lucide:sun": Sun, "lucide:train-front": TrainFront, "lucide:trending-up": TrendingUp,
  "lucide:user-round": UserRound, "lucide:utensils": Utensils, "lucide:wallet": Wallet,
  "lucide:wifi": Wifi, "lucide:wrench": Wrench, "lucide:zap": Zap,
};

export function CategoryIcon({ icon, className }: { icon?: string | null; className?: string }) {
  const Icon = icons[isCategoryIcon(icon) ? icon : DEFAULT_CATEGORY_ICON] || Folder;
  return <Icon aria-hidden="true" strokeWidth={1.8} className={cn("inline-block size-5 shrink-0 align-middle", className)} />;
}

const avatarColors = [
  "bg-violet-100 text-violet-700", "bg-sky-100 text-sky-700",
  "bg-rose-100 text-rose-700", "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800", "bg-indigo-100 text-indigo-700",
];

export function MemberAvatar({ avatar, name, memberId, className }: {
  avatar?: string | null;
  name: string;
  memberId?: string;
  className?: string;
}) {
  const value = isMemberAvatar(avatar) ? avatar : DEFAULT_MEMBER_AVATAR;
  const Icon = icons[value] || UserRound;
  const initial = Array.from(name.trim())[0] || "我";
  const colorSeed = memberId || name;
  let hash = 0;
  for (const char of colorSeed) hash = (hash * 31 + char.codePointAt(0)!) >>> 0;
  return (
    <span aria-hidden="true" className={cn(
      "inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-xs font-medium",
      avatarColors[hash % avatarColors.length], className,
    )}>
      {value === "initials" ? initial : MEMBER_AVATAR_TEXT[value] || (value.startsWith("family:")
        ? <FamilyAvatarIcon role={value.slice("family:".length)} className="h-[78%] w-[78%]" />
        : <Icon strokeWidth={1.8} className="h-[60%] w-[60%]" />)}
    </span>
  );
}
