import * as React from "react"

const Alert = React.forwardRef(({ className, variant = "default", children, ...props }, ref) => {
  const variantClasses = {
    default: "bg-gray-100 text-gray-900",
    destructive: "bg-red-50 text-red-900",
    success: "bg-green-50 text-green-900",
    warning: "bg-yellow-50 text-yellow-900"
  }

  return (
    <div
      ref={ref}
      role="alert"
      className={`relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-current ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </div>
  )
})
Alert.displayName = "Alert"

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={`text-sm [&_p]:leading-relaxed ${className}`}
    {...props}
  />
))
AlertDescription.displayName = "AlertDescription"

const AlertTitle = React.forwardRef(({ className, ...props }, ref) => (
  <h5
    ref={ref}
    className={`mb-1 font-medium leading-none tracking-tight ${className}`}
    {...props}
  />
))
AlertTitle.displayName = "AlertTitle"

export { Alert, AlertDescription, AlertTitle }